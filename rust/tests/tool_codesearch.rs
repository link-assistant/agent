//! Tests for the codesearch tool.
//!
//! Mirrors test coverage from js/tests/integration/codesearch.tools.test.js
//! and the original inline tests from rust/src/tool/codesearch.rs.

use agent::tool::codesearch::CodeSearchTool;
use agent::tool::Tool;

#[test]
fn test_params_schema() {
    let tool = CodeSearchTool;
    let schema = tool.parameters_schema();
    assert!(schema["properties"]["query"].is_object());
}

#[test]
fn test_codesearch_tool_id() {
    let tool = CodeSearchTool;
    assert_eq!(tool.id(), "codesearch");
}

#[test]
fn test_codesearch_tool_description() {
    let tool = CodeSearchTool;
    assert!(!tool.description().is_empty());
}
