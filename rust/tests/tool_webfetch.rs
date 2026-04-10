//! Tests for the webfetch tool.
//!
//! Mirrors test coverage from js/tests/integration/webfetch.tools.test.js
//! and the original inline tests from rust/src/tool/webfetch.rs.

use agent::tool::webfetch::{decode_html_entities, extract_text_from_html, strip_remaining_tags};

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

// --- Additional tests matching JS webfetch tool coverage ---

#[test]
fn test_extract_text_strips_style_tags() {
    let html = "<html><head><style>body { color: red; }</style></head><body>Visible</body></html>";
    let text = extract_text_from_html(html);
    assert!(text.contains("Visible"));
    assert!(!text.contains("color"));
}

#[test]
fn test_decode_html_entities_all() {
    assert_eq!(decode_html_entities("&amp;"), "&");
    assert_eq!(decode_html_entities("&lt;"), "<");
    assert_eq!(decode_html_entities("&gt;"), ">");
    assert_eq!(decode_html_entities("&quot;"), "\"");
    assert_eq!(decode_html_entities("&#39;"), "'");
    assert_eq!(decode_html_entities("&nbsp;"), " ");
    assert_eq!(decode_html_entities("&apos;"), "'");
}

#[test]
fn test_strip_tags_nested() {
    let html = "<div><span><a href='#'>Link</a></span></div>";
    let stripped = strip_remaining_tags(html);
    assert_eq!(stripped, "Link");
}

#[test]
fn test_strip_tags_empty() {
    let html = "";
    let stripped = strip_remaining_tags(html);
    assert_eq!(stripped, "");
}

#[test]
fn test_extract_text_from_plain() {
    let text = extract_text_from_html("Just plain text");
    assert!(text.contains("Just plain text"));
}

use agent::tool::webfetch::WebFetchTool;
use agent::tool::Tool;

#[test]
fn test_webfetch_tool_id() {
    let tool = WebFetchTool;
    assert_eq!(tool.id(), "webfetch");
}

#[test]
fn test_webfetch_tool_parameters_schema() {
    let tool = WebFetchTool;
    let schema = tool.parameters_schema();
    assert!(schema["properties"]["url"].is_object());
}
