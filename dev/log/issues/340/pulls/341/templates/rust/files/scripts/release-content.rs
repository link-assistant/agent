//! Byte-preserving release heading scanner shared by changelog writers/readers.
#![allow(dead_code)] // Standalone readers and writers use different subsets.

// Keep rust-script from wrapping this shared module as an expression.
#[cfg(test)]
#[allow(clippy::missing_const_for_fn)] // rust-script detects a non-const main.
fn main() {}

#[derive(Debug)]
pub struct Heading<'a> {
    pub version: &'a str,
    pub start: usize,
    pub body_start: usize,
}

pub fn release_headings(content: &str) -> Vec<Heading<'_>> {
    let mut headings = Vec::new();
    let mut fence: Option<(u8, usize)> = None;
    let mut offset = 0;
    for line in content.split_inclusive('\n') {
        let text = line.trim_end_matches(['\r', '\n']);
        let indent = text.bytes().take_while(|b| *b == b' ').count();
        if indent <= 3 {
            let text = &text[indent..];
            let delimiter = text.as_bytes().first().copied().unwrap_or(0);
            let length = text.bytes().take_while(|b| *b == delimiter).count();
            if let Some((opening, opening_length)) = fence {
                if delimiter == opening
                    && length >= opening_length
                    && text[length..].trim().is_empty()
                {
                    fence = None;
                }
            } else if matches!(delimiter, b'`' | b'~')
                && length >= 3
                && (delimiter == b'~' || !text[length..].contains('`'))
            {
                fence = Some((delimiter, length));
            } else if let Some(rest) = text.strip_prefix("## [") {
                if let Some((version, suffix)) = rest.split_once(']') {
                    if !version.is_empty()
                        && (suffix.is_empty() || suffix.starts_with(char::is_whitespace))
                    {
                        headings.push(Heading {
                            version,
                            start: offset,
                            body_start: offset + line.len(),
                        });
                    }
                }
            }
        }
        offset += line.len();
    }
    headings
}

pub fn extract_section<'a>(content: &'a str, version: &str) -> Result<&'a str, String> {
    let headings = release_headings(content);
    let index = headings
        .iter()
        .position(|heading| heading.version == version)
        .ok_or_else(|| format!("Missing required changelog entry for {version}"))?;
    let end = headings
        .get(index + 1)
        .map_or(content.len(), |heading| heading.start);
    Ok(&content[headings[index].body_start..end])
}

pub fn release_notes(content: &str, version: &str) -> Result<String, String> {
    let body = extract_section(content, version)?;
    Ok(if body.trim().is_empty() {
        format!("Release v{version}")
    } else {
        body.to_owned()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fenced_headings_do_not_truncate_or_select_notes() {
        for delimiter in ["```", "~~~~", "  ````"] {
            let body = format!("\r\n  Example:\r\n{delimiter}md\r\n## [9.9.9]\r\n{delimiter}\r\n\r\n### Fixed\r\n  Remaining details.\r\n\r\n");
            let content = format!("## [1.2.3]\r\n{body}## [1.2.2]\r\nold");
            assert_eq!(extract_section(&content, "1.2.3").unwrap(), body);
            assert!(extract_section(&content, "9.9.9").is_err());
            assert_eq!(release_headings(&content).len(), 2);
        }
    }

    #[test]
    fn fences_require_matching_delimiter_length_and_no_closing_info() {
        let body = "````md\n```\n## [fake-short]\n~~~~\n## [fake-other]\n```` info\n## [fake-info]\n`````\n  preserved\n";
        let content = format!("## [1.2.3]\n{body}## [1.2.2]\nold");
        assert_eq!(extract_section(&content, "1.2.3").unwrap(), body);
        assert_eq!(release_headings(&content).len(), 2);
        assert!(extract_section("```\n## [1.2.3]\nnever closed", "1.2.3").is_err());
    }

    #[test]
    fn headings_are_exact_and_indented_code_is_not_a_release() {
        let content =
            "    ## [1.2.3]\n## [1.2.30]\nwrong\n## [1.2.3]suffix\n## [1.2.3] - date\n  body\n";
        assert_eq!(extract_section(content, "1.2.3").unwrap(), "  body\n");
        assert!(extract_section(content, "missing").is_err());
    }
}
