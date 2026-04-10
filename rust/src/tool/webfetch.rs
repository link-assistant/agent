//! WebFetch tool implementation
//!
//! Fetches content from URLs and converts HTML to markdown or text,
//! matching the JavaScript implementation's webfetch tool behavior.

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{context::ToolContext, Tool, ToolResult};
use crate::error::{AgentError, Result};

/// Maximum response size: 5MB
const MAX_RESPONSE_SIZE: usize = 5 * 1024 * 1024;

/// Default timeout in seconds
const DEFAULT_TIMEOUT_SECS: u64 = 30;

/// Maximum timeout in seconds
const MAX_TIMEOUT_SECS: u64 = 120;

/// Tool description
const DESCRIPTION: &str = r#"Fetches content from a specified URL and processes it using an AI model.

Usage:
- Takes a URL and a format (text, markdown, or html)
- Fetches the URL content
- For markdown/text formats, converts HTML to readable format
- Returns the processed content
- Use this tool when you need to retrieve and analyze web content"#;

/// Parameters for the webfetch tool
#[derive(Debug, Deserialize)]
pub struct WebFetchParams {
    /// The URL to fetch content from
    pub url: String,
    /// The format to return the content in
    pub format: String,
    /// Optional timeout in seconds (max 120)
    #[serde(default)]
    pub timeout: Option<u64>,
}

/// WebFetch tool implementation
pub struct WebFetchTool;

#[async_trait]
impl Tool for WebFetchTool {
    fn id(&self) -> &'static str {
        "webfetch"
    }

    fn description(&self) -> &'static str {
        DESCRIPTION
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The URL to fetch content from"
                },
                "format": {
                    "type": "string",
                    "enum": ["text", "markdown", "html"],
                    "description": "The format to return the content in (text, markdown, or html)"
                },
                "timeout": {
                    "type": "number",
                    "description": "Optional timeout in seconds (max 120)"
                }
            },
            "required": ["url", "format"]
        })
    }

    async fn execute(&self, params: Value, _ctx: &ToolContext) -> Result<ToolResult> {
        let params: WebFetchParams = serde_json::from_value(params)
            .map_err(|e| AgentError::invalid_arguments("webfetch", e.to_string()))?;

        // Validate URL
        if !params.url.starts_with("http://") && !params.url.starts_with("https://") {
            return Err(AgentError::invalid_arguments(
                "webfetch",
                "URL must start with http:// or https://",
            ));
        }

        let timeout_secs = params
            .timeout
            .unwrap_or(DEFAULT_TIMEOUT_SECS)
            .min(MAX_TIMEOUT_SECS);

        let timeout_duration = tokio::time::Duration::from_secs(timeout_secs);

        // Build Accept header based on requested format
        let accept_header = match params.format.as_str() {
            "markdown" => "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1",
            "text" => "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1",
            "html" => "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, */*;q=0.1",
            _ => "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        };

        let client = reqwest::Client::builder()
            .timeout(timeout_duration)
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .build()
            .map_err(|e| AgentError::tool_execution("webfetch", e.to_string()))?;

        let response = client
            .get(&params.url)
            .header("Accept", accept_header)
            .header("Accept-Language", "en-US,en;q=0.9")
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    AgentError::tool_execution("webfetch", "Request timed out")
                } else {
                    AgentError::tool_execution("webfetch", e.to_string())
                }
            })?;

        if !response.status().is_success() {
            return Err(AgentError::tool_execution(
                "webfetch",
                format!("Request failed with status code: {}", response.status()),
            ));
        }

        // Check content length
        if let Some(content_length) = response.content_length() {
            if content_length as usize > MAX_RESPONSE_SIZE {
                return Err(AgentError::tool_execution(
                    "webfetch",
                    "Response too large (exceeds 5MB limit)",
                ));
            }
        }

        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        let bytes = response
            .bytes()
            .await
            .map_err(|e| AgentError::tool_execution("webfetch", e.to_string()))?;

        if bytes.len() > MAX_RESPONSE_SIZE {
            return Err(AgentError::tool_execution(
                "webfetch",
                "Response too large (exceeds 5MB limit)",
            ));
        }

        let content = String::from_utf8_lossy(&bytes).into_owned();
        let title = format!("{} ({})", params.url, content_type);

        let output = match params.format.as_str() {
            "markdown" => {
                if content_type.contains("text/html") {
                    html_to_markdown(&content)
                } else {
                    content
                }
            }
            "text" => {
                if content_type.contains("text/html") {
                    extract_text_from_html(&content)
                } else {
                    content
                }
            }
            _ => content, // "html" or default: return as-is
        };

        Ok(ToolResult {
            title,
            output,
            metadata: json!({}),
            attachments: None,
        })
    }
}

/// Extract plain text from HTML by stripping tags
fn extract_text_from_html(html: &str) -> String {
    let mut text = String::new();
    let mut in_tag = false;
    let mut in_script_or_style = false;
    let mut tag_buffer = String::new();

    let chars: Vec<char> = html.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        match chars[i] {
            '<' => {
                in_tag = true;
                tag_buffer.clear();
                i += 1;
            }
            '>' => {
                in_tag = false;
                let tag = tag_buffer.trim().to_lowercase();
                // Check for script/style open/close tags
                if tag == "script"
                    || tag == "style"
                    || tag == "noscript"
                    || tag == "iframe"
                    || tag == "object"
                    || tag == "embed"
                {
                    in_script_or_style = true;
                } else if tag == "/script"
                    || tag == "/style"
                    || tag == "/noscript"
                    || tag == "/iframe"
                    || tag == "/object"
                    || tag == "/embed"
                {
                    in_script_or_style = false;
                }
                tag_buffer.clear();
                i += 1;
            }
            c if in_tag => {
                tag_buffer.push(c);
                i += 1;
            }
            c if !in_script_or_style => {
                text.push(c);
                i += 1;
            }
            _ => {
                i += 1;
            }
        }
    }

    // Collapse whitespace
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

/// Convert HTML to basic markdown format
fn html_to_markdown(html: &str) -> String {
    // Basic HTML-to-markdown conversion
    // Strip script/style tags and their content first
    let mut result = html.to_string();

    // Remove script tags and content
    result = remove_tag_with_content(&result, "script");
    result = remove_tag_with_content(&result, "style");
    result = remove_tag_with_content(&result, "noscript");

    // Convert common HTML elements to markdown
    result = convert_headings(&result);
    result = convert_links(&result);
    result = convert_bold_italic(&result);
    result = convert_code(&result);
    result = strip_remaining_tags(&result);

    // Decode HTML entities
    result = decode_html_entities(&result);

    // Clean up whitespace
    result
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn remove_tag_with_content(html: &str, tag: &str) -> String {
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);
    let mut result = html.to_string();
    loop {
        if let Some(start) = result.to_lowercase().find(&open) {
            if let Some(end) = result.to_lowercase()[start..].find(&close) {
                result.replace_range(start..start + end + close.len(), "");
            } else {
                break;
            }
        } else {
            break;
        }
    }
    result
}

fn convert_headings(html: &str) -> String {
    let mut result = html.to_string();
    for level in 1..=6 {
        let tag = format!("h{}", level);
        let prefix = "#".repeat(level);
        result = replace_tag_with_prefix(&result, &tag, &format!("{} ", prefix));
    }
    result
}

fn replace_tag_with_prefix(html: &str, tag: &str, prefix: &str) -> String {
    let open_re = format!("<{}[^>]*>", tag);
    let close = format!("</{}>", tag);
    let lower = html.to_lowercase();
    let mut result = html.to_string();
    let mut offset = 0i64;

    // Simple approach: find and replace each tag
    let mut search_start = 0;
    loop {
        let lower_shifted = &lower[search_start..];
        if let Some(pos) = lower_shifted.find(&format!("<{}", tag)) {
            let abs_pos = search_start + pos;
            // Find end of opening tag
            if let Some(tag_end) = lower[abs_pos..].find('>') {
                let after_open = abs_pos + tag_end + 1;
                // Find closing tag
                if let Some(close_pos) = lower[after_open..].find(&close) {
                    let close_abs = after_open + close_pos;
                    let close_end = close_abs + close.len();
                    let inner = &result[after_open..close_abs];
                    let replacement = format!("{}{}\n", prefix, inner);
                    result.replace_range(abs_pos..close_end, &replacement);
                    search_start = abs_pos + replacement.len();
                    // Update lower
                    let lower_new = result.to_lowercase();
                    // Need to re-create lower from updated result
                    return replace_tag_with_prefix(&result, tag, prefix); // recurse to handle multiple
                } else {
                    break;
                }
            } else {
                break;
            }
        } else {
            break;
        }
    }
    result
}

fn convert_links(html: &str) -> String {
    // Very basic: <a href="url">text</a> -> [text](url)
    let mut result = html.to_string();
    loop {
        let lower = result.to_lowercase();
        if let Some(start) = lower.find("<a ") {
            let href_start = lower[start..].find("href=\"");
            let href = href_start.map(|h| {
                let href_content_start = start + h + 6;
                result[href_content_start..]
                    .find('"')
                    .map(|end| result[href_content_start..href_content_start + end].to_string())
            }).flatten();

            if let Some(tag_end) = lower[start..].find('>') {
                let inner_start = start + tag_end + 1;
                if let Some(close_pos) = lower[inner_start..].find("</a>") {
                    let inner = &result[inner_start..inner_start + close_pos];
                    let replacement = if let Some(url) = href {
                        format!("[{}]({})", inner, url)
                    } else {
                        inner.to_string()
                    };
                    result.replace_range(start..inner_start + close_pos + 4, &replacement);
                    continue;
                }
            }
            break;
        } else {
            break;
        }
    }
    result
}

fn convert_bold_italic(html: &str) -> String {
    let mut result = html.to_string();
    // Bold: <b>text</b> or <strong>text</strong> -> **text**
    for tag in &["b", "strong"] {
        result = replace_inline_tag(&result, tag, "**");
    }
    // Italic: <i>text</i> or <em>text</em> -> *text*
    for tag in &["i", "em"] {
        result = replace_inline_tag(&result, tag, "*");
    }
    result
}

fn replace_inline_tag(html: &str, tag: &str, marker: &str) -> String {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    html.replace(&open, marker).replace(&close, marker)
}

fn convert_code(html: &str) -> String {
    let mut result = html.to_string();
    // Code blocks: <pre><code>content</code></pre> -> ```content```
    result = result.replace("<pre><code>", "```\n").replace("</code></pre>", "\n```");
    // Inline code: <code>text</code> -> `text`
    result = replace_inline_tag(&result, "code", "`");
    result
}

fn strip_remaining_tags(html: &str) -> String {
    let mut result = String::new();
    let mut in_tag = false;

    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            c if !in_tag => result.push(c),
            _ => {}
        }
    }
    result
}

fn decode_html_entities(html: &str) -> String {
    html.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
        .replace("&apos;", "'")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_text_from_html() {
        let html = "<html><body><h1>Hello</h1><p>World</p><script>alert('x')</script></body></html>";
        let text = extract_text_from_html(html);
        assert!(text.contains("Hello"));
        assert!(text.contains("World"));
        assert!(!text.contains("alert"));
    }

    #[test]
    fn test_html_entities() {
        let html = "Hello &amp; World &lt;tag&gt;";
        let decoded = decode_html_entities(html);
        assert_eq!(decoded, "Hello & World <tag>");
    }

    #[test]
    fn test_strip_tags() {
        let html = "<p>Hello <b>World</b></p>";
        let stripped = strip_remaining_tags(html);
        assert_eq!(stripped, "Hello World");
    }
}
