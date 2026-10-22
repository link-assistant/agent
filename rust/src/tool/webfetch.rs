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

/// Browser UA sent first (upstream 774c24e76e, #8284).
const BROWSER_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

/// Honest UA for the Cloudflare challenge retry (upstream b978ca11da, #10328).
const HONEST_USER_AGENT: &str = "agent";

/// Error for a body over the size limit.
pub const TOO_LARGE: &str = "Response too large (exceeds 5MB limit)";

/// Tool description
const DESCRIPTION: &str = r#"Fetches content from a specified URL and processes it using an AI model.

Usage:
- Takes a URL and an optional format (text, markdown, or html; markdown by default)
- Fetches the URL content
- For markdown/text formats, converts HTML to readable format
- Returns the processed content
- Use this tool when you need to retrieve and analyze web content"#;

/// Parameters for the webfetch tool
#[derive(Debug, Deserialize)]
pub struct WebFetchParams {
    /// The URL to fetch content from
    pub url: String,
    /// The format to return the content in. Optional so models that omit it
    /// still get markdown (upstream fd973d242e, #6345).
    #[serde(default = "default_format")]
    pub format: String,
    /// Optional timeout in seconds (max 120)
    #[serde(default)]
    pub timeout: Option<u64>,
}

fn default_format() -> String {
    "markdown".to_string()
}

/// Read a response body, failing as soon as it exceeds `max` bytes instead of
/// buffering an oversized, chunked or endless body before checking its size
/// (upstream 69f1ec22e3, #33259).
pub async fn read_body_bounded(
    mut response: reqwest::Response,
    max: usize,
) -> std::result::Result<Vec<u8>, BodyError> {
    if response
        .content_length()
        .is_some_and(|length| length as usize > max)
    {
        return Err(BodyError::TooLarge);
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(BodyError::Http)? {
        if body.len() + chunk.len() > max {
            return Err(BodyError::TooLarge);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

/// Failure of [`read_body_bounded`].
#[derive(Debug)]
pub enum BodyError {
    TooLarge,
    Http(reqwest::Error),
}

impl std::fmt::Display for BodyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BodyError::TooLarge => f.write_str(TOO_LARGE),
            BodyError::Http(e) if e.is_timeout() => f.write_str("Request timed out"),
            BodyError::Http(e) => write!(f, "{}", e),
        }
    }
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
                    "description": "The format to return the content in (text, markdown, or html). Defaults to markdown."
                },
                "timeout": {
                    "type": "number",
                    "description": "Optional timeout in seconds (max 120)"
                }
            },
            "required": ["url"]
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

        // The client timeout also covers reading the body.
        let client = reqwest::Client::builder()
            .timeout(timeout_duration)
            .build()
            .map_err(|e| AgentError::tool_execution("webfetch", e.to_string()))?;

        let send = |user_agent: &'static str| {
            client
                .get(&params.url)
                .header("User-Agent", user_agent)
                .header("Accept", accept_header)
                .header("Accept-Language", "en-US,en;q=0.9")
                .send()
        };
        let request_error = |e: reqwest::Error| {
            if e.is_timeout() {
                AgentError::tool_execution("webfetch", "Request timed out")
            } else {
                AgentError::tool_execution("webfetch", e.to_string())
            }
        };

        let mut response = send(BROWSER_USER_AGENT).await.map_err(request_error)?;
        // Cloudflare challenges a Chrome UA whose TLS fingerprint is not
        // Chrome's, and lets an honest UA through.
        if response.status() == reqwest::StatusCode::FORBIDDEN
            && response
                .headers()
                .get("cf-mitigated")
                .is_some_and(|v| v == "challenge")
        {
            response = send(HONEST_USER_AGENT).await.map_err(request_error)?;
        }

        if !response.status().is_success() {
            return Err(AgentError::tool_execution(
                "webfetch",
                format!("Request failed with status code: {}", response.status()),
            ));
        }

        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        let bytes = read_body_bounded(response, MAX_RESPONSE_SIZE)
            .await
            .map_err(|e| AgentError::tool_execution("webfetch", e.to_string()))?;

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
            is_error: false,
            title,
            output,
            metadata: json!({}),
            attachments: None,
        })
    }
}

/// Extract plain text from HTML by stripping tags
pub fn extract_text_from_html(html: &str) -> String {
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
    while let Some(start) = result.to_lowercase().find(&open) {
        if let Some(end) = result.to_lowercase()[start..].find(&close) {
            result.replace_range(start..start + end + close.len(), "");
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
    let close = format!("</{}>", tag);
    let lower = html.to_lowercase();
    let mut result = html.to_string();

    // Find the first occurrence of the opening tag
    if let Some(pos) = lower.find(&format!("<{}", tag)) {
        // Find end of opening tag
        if let Some(tag_end) = lower[pos..].find('>') {
            let after_open = pos + tag_end + 1;
            // Find closing tag
            if let Some(close_pos) = lower[after_open..].find(&close) {
                let close_abs = after_open + close_pos;
                let close_end = close_abs + close.len();
                let inner = &result[after_open..close_abs];
                let replacement = format!("{}{}\n", prefix, inner);
                result.replace_range(pos..close_end, &replacement);
                // Recurse to handle multiple occurrences
                return replace_tag_with_prefix(&result, tag, prefix);
            }
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
            let href = href_start.and_then(|h| {
                let href_content_start = start + h + 6;
                result[href_content_start..]
                    .find('"')
                    .map(|end| result[href_content_start..href_content_start + end].to_string())
            });

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
    result = result
        .replace("<pre><code>", "```\n")
        .replace("</code></pre>", "\n```");
    // Inline code: <code>text</code> -> `text`
    result = replace_inline_tag(&result, "code", "`");
    result
}

pub fn strip_remaining_tags(html: &str) -> String {
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

pub fn decode_html_entities(html: &str) -> String {
    html.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
        .replace("&apos;", "'")
}
