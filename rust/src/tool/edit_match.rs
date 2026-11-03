//! Edit matching ported from the JavaScript edit tool (`js/src/tool/edit.ts`).
//!
//! Each replacer returns, in order, the spans of the content that may be
//! what `oldString` meant. [`replace`] walks the replacers in the JS order
//! and uses the first candidate that occurs in the content:
//!
//! - a candidate spanning far more text than `oldString` is refused with an
//!   error instead of being replaced (upstream OpenCode #30932);
//! - with `replaceAll` every occurrence of that candidate is replaced;
//! - otherwise the candidate must occur once, else the next one is tried.
//!
//! Whitespace and trimming follow JavaScript (`String#trim`, `\s`), and
//! lengths used by the similarity checks are counted in UTF-16 code units,
//! as in JS.
//!
//! One deliberate difference: an empty candidate (a whitespace-only
//! `oldString` can produce one) is skipped. JS would accept it and, with
//! `replaceAll`, insert `newString` between every character.

use regex::Regex;

/// Error for an empty `oldString` on an existing file.
pub const EMPTY_OLD_STRING_ERROR: &str = "oldString cannot be empty when editing an existing file. Provide the exact text to replace, or use write for an intentional full-file replacement.";
/// Error when `oldString` and `newString` are the same.
pub const SAME_STRING_ERROR: &str = "oldString and newString must be different";
/// Error when no replacer finds `oldString`.
pub const NOT_FOUND_ERROR: &str = "oldString not found in content";
/// Error when every candidate occurs more than once.
pub const MULTIPLE_MATCHES_ERROR: &str = "Found multiple matches for oldString. Provide more surrounding lines in oldString to identify the correct match.";
/// Error for a candidate much larger than `oldString`.
pub const DISPROPORTIONATE_ERROR: &str = "Refusing replacement because the matched span is much larger than oldString. Re-read the file and provide the full exact oldString for the intended replacement.";

/// Minimum middle-line similarity for a block-anchor match (JS
/// `SINGLE_CANDIDATE_SIMILARITY_THRESHOLD` and
/// `MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD`).
const BLOCK_ANCHOR_THRESHOLD: f64 = 0.65;

/// A replacer: candidate spans of `content` for `find`, in order.
pub type Replacer = fn(&str, &str) -> Vec<String>;

/// The replacers in the order the JS edit tool tries them.
pub const REPLACERS: &[(&str, Replacer)] = &[
    ("SimpleReplacer", simple),
    ("LineTrimmedReplacer", line_trimmed),
    ("BlockAnchorReplacer", block_anchor),
    ("WhitespaceNormalizedReplacer", whitespace_normalized),
    ("IndentationFlexibleReplacer", indentation_flexible),
    ("EscapeNormalizedReplacer", escape_normalized),
    ("TrimmedBoundaryReplacer", trimmed_boundary),
    ("ContextAwareReplacer", context_aware),
    ("MultiOccurrenceReplacer", multi_occurrence),
];

/// Replace `old` with `new` in `content` (JS `replace`). The error is the
/// JS message.
pub fn replace(
    content: &str,
    old: &str,
    new: &str,
    replace_all: bool,
) -> std::result::Result<String, &'static str> {
    if old == new {
        return Err(SAME_STRING_ERROR);
    }
    if old.is_empty() {
        return Err(EMPTY_OLD_STRING_ERROR);
    }

    let mut not_found = true;
    for (_, replacer) in REPLACERS {
        for search in replacer(content, old) {
            if search.is_empty() {
                continue;
            }
            let Some(index) = content.find(&search) else {
                continue;
            };
            not_found = false;
            if is_disproportionate_match(&search, old) {
                return Err(DISPROPORTIONATE_ERROR);
            }
            if replace_all {
                return Ok(content.replace(&search, new));
            }
            if content.rfind(&search) != Some(index) {
                continue;
            }
            let mut out = String::with_capacity(content.len() + new.len());
            out.push_str(&content[..index]);
            out.push_str(new);
            out.push_str(&content[index + search.len()..]);
            return Ok(out);
        }
    }

    if not_found {
        Err(NOT_FOUND_ERROR)
    } else {
        Err(MULTIPLE_MATCHES_ERROR)
    }
}

/// JavaScript whitespace: what `String#trim` removes and `\s` matches.
pub fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

/// JavaScript `String#trim`.
pub fn js_trim(text: &str) -> &str {
    text.trim_matches(is_js_whitespace)
}

/// Regex class for one or more JavaScript whitespace characters.
const JS_WHITESPACE_RUN: &str = r"[\t\n\x0B\x0C\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]+";

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// Byte ranges of the `\n`-separated lines of `content` (JS
/// `content.split('\n')`).
fn line_spans(content: &str) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let mut start = 0;
    for (i, b) in content.bytes().enumerate() {
        if b == b'\n' {
            spans.push((start, i));
            start = i + 1;
        }
    }
    spans.push((start, content.len()));
    spans
}

/// Lines `first..=last` of `content`, joined with `\n`.
fn span(content: &str, spans: &[(usize, usize)], first: usize, last: usize) -> String {
    content[spans[first].0..spans[last].1].to_string()
}

/// Start indexes of every window of `size` lines in `count` lines.
fn windows(count: usize, size: usize) -> std::ops::Range<usize> {
    if size > count {
        0..0
    } else {
        0..count - size + 1
    }
}

/// JS `SimpleReplacer`.
pub fn simple(_content: &str, find: &str) -> Vec<String> {
    vec![find.to_string()]
}

/// JS `LineTrimmedReplacer`: lines equal after trimming.
pub fn line_trimmed(content: &str, find: &str) -> Vec<String> {
    let spans = line_spans(content);
    let mut search: Vec<&str> = find.split('\n').collect();
    if search.last() == Some(&"") {
        search.pop();
    }
    if search.is_empty() {
        return Vec::new();
    }
    let search: Vec<&str> = search.into_iter().map(js_trim).collect();
    let mut found = Vec::new();
    for i in windows(spans.len(), search.len()) {
        let matches = search
            .iter()
            .enumerate()
            .all(|(j, s)| js_trim(&content[spans[i + j].0..spans[i + j].1]) == *s);
        if matches {
            found.push(span(content, &spans, i, i + search.len() - 1));
        }
    }
    found
}

/// Levenshtein distance over UTF-16 code units, as in JS.
fn levenshtein(a: &[u16], b: &[u16]) -> usize {
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0; b.len() + 1];
    for (i, ca) in a.iter().enumerate() {
        cur[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let cost = usize::from(ca != cb);
            cur[j + 1] = (prev[j + 1] + 1).min(cur[j] + 1).min(prev[j] + cost);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}

/// `1 - distance / maxLen` of two trimmed lines, `None` when both are empty
/// (JS skips such lines: they add nothing to the sum).
fn line_similarity(a: &str, b: &str) -> Option<f64> {
    let a: Vec<u16> = js_trim(a).encode_utf16().collect();
    let b: Vec<u16> = js_trim(b).encode_utf16().collect();
    let max_len = a.len().max(b.len());
    if max_len == 0 {
        return None;
    }
    Some(1.0 - levenshtein(&a, &b) as f64 / max_len as f64)
}

/// JS `BlockAnchorReplacer`: first and last lines match after trimming, the
/// block has about the same size and the middle lines are similar. Of
/// several candidate blocks only the most similar one is returned.
pub fn block_anchor(content: &str, find: &str) -> Vec<String> {
    let mut search: Vec<&str> = find.split('\n').collect();
    if search.len() < 3 {
        return Vec::new();
    }
    if search.last() == Some(&"") {
        search.pop();
    }
    let spans = line_spans(content);
    let line = |k: usize| &content[spans[k].0..spans[k].1];
    let first = js_trim(search[0]);
    let last = js_trim(search[search.len() - 1]);
    let size = search.len();
    let max_delta = std::cmp::max(1, size / 4);

    let mut candidates: Vec<(usize, usize)> = Vec::new();
    for i in 0..spans.len() {
        if js_trim(line(i)) != first {
            continue;
        }
        for j in (i + 2)..spans.len() {
            if js_trim(line(j)) == last {
                if (j - i + 1).abs_diff(size) <= max_delta {
                    candidates.push((i, j));
                }
                break;
            }
        }
    }

    let similarity = |(start, end): (usize, usize), early_exit: bool| -> f64 {
        let actual = end - start + 1;
        let lines_to_check = std::cmp::min(size - 2, actual - 2);
        if lines_to_check == 0 {
            return 1.0;
        }
        let mut similarity = 0.0;
        let mut j = 1;
        while j < size - 1 && j < actual - 1 {
            if let Some(s) = line_similarity(line(start + j), search[j]) {
                if early_exit {
                    similarity += s / lines_to_check as f64;
                    if similarity >= BLOCK_ANCHOR_THRESHOLD {
                        break;
                    }
                } else {
                    similarity += s;
                }
            }
            j += 1;
        }
        if early_exit {
            similarity
        } else {
            similarity / lines_to_check as f64
        }
    };

    let best = match candidates.as_slice() {
        [] => return Vec::new(),
        [only] => Some((*only, similarity(*only, true))),
        _ => {
            let mut best: Option<((usize, usize), f64)> = None;
            for candidate in &candidates {
                let s = similarity(*candidate, false);
                if best.is_none_or(|(_, max)| s > max) {
                    best = Some((*candidate, s));
                }
            }
            best
        }
    };
    match best {
        Some(((start, end), s)) if s >= BLOCK_ANCHOR_THRESHOLD => {
            vec![span(content, &spans, start, end)]
        }
        _ => Vec::new(),
    }
}

/// Collapse runs of JS whitespace to one space and trim.
fn normalize_whitespace(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_space = false;
    for c in text.chars() {
        if is_js_whitespace(c) {
            in_space = true;
        } else {
            if in_space && !out.is_empty() {
                out.push(' ');
            }
            in_space = false;
            out.push(c);
        }
    }
    out
}

/// JS `WhitespaceNormalizedReplacer`: lines (or the part of a line) and
/// blocks equal after collapsing whitespace.
pub fn whitespace_normalized(content: &str, find: &str) -> Vec<String> {
    let normalized_find = normalize_whitespace(find);
    let lines: Vec<&str> = content.split('\n').collect();
    let mut found = Vec::new();
    let mut pattern: Option<Option<Regex>> = None;
    for line in &lines {
        let normalized = normalize_whitespace(line);
        if normalized == normalized_find {
            found.push(line.to_string());
        } else if normalized.contains(&normalized_find) {
            let regex = pattern.get_or_insert_with(|| {
                let words: Vec<String> = js_trim(find)
                    .split(is_js_whitespace)
                    .filter(|w| !w.is_empty())
                    .map(regex::escape)
                    .collect();
                if words.is_empty() {
                    None
                } else {
                    Regex::new(&words.join(JS_WHITESPACE_RUN)).ok()
                }
            });
            if let Some(m) = regex.as_ref().and_then(|r| r.find(line)) {
                found.push(m.as_str().to_string());
            }
        }
    }

    let find_lines = find.split('\n').count();
    if find_lines > 1 {
        for i in windows(lines.len(), find_lines) {
            let block = lines[i..i + find_lines].join("\n");
            if normalize_whitespace(&block) == normalized_find {
                found.push(block);
            }
        }
    }
    found
}

/// JS `IndentationFlexibleReplacer`: blocks equal after removing their
/// common indentation.
pub fn indentation_flexible(content: &str, find: &str) -> Vec<String> {
    fn remove_indentation(text: &str) -> String {
        let lines: Vec<&str> = text.split('\n').collect();
        let indent = |line: &str| line.chars().take_while(|c| is_js_whitespace(*c)).count();
        let Some(min_indent) = lines
            .iter()
            .filter(|l| !js_trim(l).is_empty())
            .map(|l| indent(l))
            .min()
        else {
            return text.to_string();
        };
        lines
            .iter()
            .map(|line| {
                if js_trim(line).is_empty() {
                    *line
                } else {
                    match line.char_indices().nth(min_indent) {
                        Some((idx, _)) => &line[idx..],
                        None => "",
                    }
                }
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    let normalized_find = remove_indentation(find);
    let lines: Vec<&str> = content.split('\n').collect();
    let find_lines = find.split('\n').count();
    let mut found = Vec::new();
    for i in windows(lines.len(), find_lines) {
        let block = lines[i..i + find_lines].join("\n");
        if remove_indentation(&block) == normalized_find {
            found.push(block);
        }
    }
    found
}

/// JS `unescapeString`: `\n`, `\t`, `\r`, `\'`, `\"`, `` \` ``, `\\`,
/// backslash-newline and `\$`.
fn unescape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        let mapped = match chars.peek() {
            Some('n') | Some('\n') => '\n',
            Some('t') => '\t',
            Some('r') => '\r',
            Some(&other) if matches!(other, '\'' | '"' | '`' | '\\' | '$') => other,
            _ => {
                out.push(c);
                continue;
            }
        };
        chars.next();
        out.push(mapped);
    }
    out
}

/// JS `EscapeNormalizedReplacer`: `oldString` with escape sequences
/// resolved, or blocks whose unescaped text equals it.
pub fn escape_normalized(content: &str, find: &str) -> Vec<String> {
    let unescaped_find = unescape(find);
    let mut found = Vec::new();
    if content.contains(&unescaped_find) {
        found.push(unescaped_find.clone());
    }
    let lines: Vec<&str> = content.split('\n').collect();
    let find_lines = unescaped_find.split('\n').count();
    for i in windows(lines.len(), find_lines) {
        let block = lines[i..i + find_lines].join("\n");
        if unescape(&block) == unescaped_find {
            found.push(block);
        }
    }
    found
}

/// JS `TrimmedBoundaryReplacer`: `oldString` without surrounding
/// whitespace, or blocks equal to it after trimming.
pub fn trimmed_boundary(content: &str, find: &str) -> Vec<String> {
    let trimmed = js_trim(find);
    if trimmed == find {
        return Vec::new();
    }
    let mut found = Vec::new();
    if content.contains(trimmed) {
        found.push(trimmed.to_string());
    }
    let lines: Vec<&str> = content.split('\n').collect();
    let find_lines = find.split('\n').count();
    for i in windows(lines.len(), find_lines) {
        let block = lines[i..i + find_lines].join("\n");
        if js_trim(&block) == trimmed {
            found.push(block);
        }
    }
    found
}

/// JS `ContextAwareReplacer`: same first and last lines, same size and at
/// least half of the non-empty middle lines equal after trimming.
pub fn context_aware(content: &str, find: &str) -> Vec<String> {
    let mut find_lines: Vec<&str> = find.split('\n').collect();
    if find_lines.len() < 3 {
        return Vec::new();
    }
    if find_lines.last() == Some(&"") {
        find_lines.pop();
    }
    let lines: Vec<&str> = content.split('\n').collect();
    let first = js_trim(find_lines[0]);
    let last = js_trim(find_lines[find_lines.len() - 1]);
    let mut found = Vec::new();
    for i in 0..lines.len() {
        if js_trim(lines[i]) != first {
            continue;
        }
        for j in (i + 2)..lines.len() {
            if js_trim(lines[j]) != last {
                continue;
            }
            let block = &lines[i..=j];
            if block.len() == find_lines.len() {
                let mut matching = 0usize;
                let mut non_empty = 0usize;
                for k in 1..block.len() - 1 {
                    let a = js_trim(block[k]);
                    let b = js_trim(find_lines[k]);
                    if !a.is_empty() || !b.is_empty() {
                        non_empty += 1;
                        if a == b {
                            matching += 1;
                        }
                    }
                }
                if non_empty == 0 || matching as f64 / non_empty as f64 >= 0.5 {
                    found.push(block.join("\n"));
                }
            }
            break;
        }
    }
    found
}

/// JS `MultiOccurrenceReplacer`. JS yields `find` once per occurrence; as
/// every candidate is the same string, one is enough for [`replace`].
pub fn multi_occurrence(content: &str, find: &str) -> Vec<String> {
    if content.contains(find) {
        vec![find.to_string()]
    } else {
        Vec::new()
    }
}

/// A candidate spanning far more text than `old` (upstream #30932).
pub fn is_disproportionate_match(search: &str, old: &str) -> bool {
    let old_lines = old.split('\n').count();
    let search_lines = search.split('\n').count();
    if search_lines >= std::cmp::max(old_lines + 3, old_lines * 2) {
        return true;
    }
    if old_lines == 1 {
        return false;
    }
    let old_len = utf16_len(js_trim(old));
    utf16_len(js_trim(search)) > std::cmp::max(old_len + 500, old_len * 4)
}

/// JS `trimDiff`: remove the indentation common to every non-blank content
/// line of a unified diff.
pub fn trim_diff(diff: &str) -> String {
    let is_content = |line: &str| {
        (line.starts_with('+') || line.starts_with('-') || line.starts_with(' '))
            && !line.starts_with("---")
            && !line.starts_with("+++")
    };
    let lines: Vec<&str> = diff.split('\n').collect();
    let mut min = usize::MAX;
    let mut any = false;
    for line in lines.iter().filter(|l| is_content(l)) {
        any = true;
        let text = &line[1..];
        if !js_trim(text).is_empty() {
            min = min.min(text.chars().take_while(|c| is_js_whitespace(*c)).count());
        }
    }
    if !any || min == usize::MAX || min == 0 {
        return diff.to_string();
    }
    lines
        .iter()
        .map(|line| {
            if !is_content(line) {
                return line.to_string();
            }
            let text = &line[1..];
            let rest = match text.char_indices().nth(min) {
                Some((idx, _)) => &text[idx..],
                None => "",
            };
            format!("{}{}", &line[..1], rest)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// JS `createTwoFilesPatch(path, path, old, new)` from the `diff` package:
/// an `Index:` header and `@@ -start,count +start,count @@` hunks with
/// four lines of context (the jsdiff default).
pub fn two_files_patch(path: &str, old: &str, new: &str) -> String {
    use similar::{ChangeTag, TextDiff};

    let diff = TextDiff::from_lines(old, new);
    let mut out = format!(
        "Index: {path}\n===================================================================\n--- {path}\n+++ {path}\n"
    );
    for group in diff.grouped_ops(4) {
        let (Some(first), Some(last)) = (group.first(), group.last()) else {
            continue;
        };
        let old_range = first.old_range().start..last.old_range().end;
        let new_range = first.new_range().start..last.new_range().end;
        let start = |range: &std::ops::Range<usize>| {
            if range.is_empty() {
                range.start
            } else {
                range.start + 1
            }
        };
        out.push_str(&format!(
            "@@ -{},{} +{},{} @@\n",
            start(&old_range),
            old_range.len(),
            start(&new_range),
            new_range.len()
        ));
        for op in &group {
            for change in diff.iter_changes(op) {
                out.push(match change.tag() {
                    ChangeTag::Delete => '-',
                    ChangeTag::Insert => '+',
                    ChangeTag::Equal => ' ',
                });
                out.push_str(change.value());
                if change.missing_newline() {
                    out.push_str("\n\\ No newline at end of file\n");
                }
            }
        }
    }
    out
}

/// Lines added and removed between `old` and `new` (JS `diffLines` counts).
pub fn count_changes(old: &str, new: &str) -> (usize, usize) {
    use similar::{ChangeTag, TextDiff};

    let mut additions = 0;
    let mut deletions = 0;
    for change in TextDiff::from_lines(old, new).iter_all_changes() {
        match change.tag() {
            ChangeTag::Insert => additions += 1,
            ChangeTag::Delete => deletions += 1,
            ChangeTag::Equal => {}
        }
    }
    (additions, deletions)
}
