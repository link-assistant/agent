//! Tests for the websearch tool.
//!
//! Mirrors test coverage from js/tests/integration/websearch.tools.test.js
//! and the original inline tests from rust/src/tool/websearch.rs.

use link_assistant_agent::tool::websearch::WebSearchTool;
use link_assistant_agent::tool::Tool;

#[test]
fn test_params_schema() {
    let tool = WebSearchTool;
    let schema = tool.parameters_schema();
    assert!(schema["properties"]["query"].is_object());
}

#[test]
fn test_websearch_tool_id() {
    let tool = WebSearchTool;
    assert_eq!(tool.id(), "websearch");
}

#[test]
fn test_websearch_tool_description() {
    let tool = WebSearchTool;
    assert!(!tool.description().is_empty());
}
