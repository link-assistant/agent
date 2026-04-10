//! Tests for the invalid tool.
//!
//! Mirrors the original inline tests from rust/src/tool/invalid.rs
//! and js/src/tool/invalid.ts behavior.

use agent::tool::invalid::InvalidTool;
use agent::tool::{Tool, ToolContext};
use serde_json::json;
use tempfile::TempDir;

fn create_context(dir: &std::path::Path) -> ToolContext {
    ToolContext::new("ses_test", "msg_test", dir)
}

#[tokio::test]
async fn test_invalid_tool() {
    let temp = TempDir::new().unwrap();
    let tool = InvalidTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "tool": "someTool",
        "error": "missing required parameter 'foo'"
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert_eq!(result.title, "Invalid Tool");
    assert!(result.output.contains("missing required parameter 'foo'"));
}

#[tokio::test]
async fn test_invalid_tool_includes_error_message() {
    let temp = TempDir::new().unwrap();
    let tool = InvalidTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "tool": "unknownTool",
        "error": "tool not found"
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("tool not found"));
    assert!(result.output.contains("invalid"));
}

#[test]
fn test_invalid_tool_id() {
    let tool = InvalidTool;
    assert_eq!(tool.id(), "invalid");
}
