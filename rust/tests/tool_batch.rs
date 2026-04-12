//! Tests for the batch tool.
//!
//! Mirrors test coverage from js/tests/integration/batch.tools.test.js
//! and the original inline tests from rust/src/tool/batch.rs.

use link_assistant_agent::tool::batch::BatchTool;
use link_assistant_agent::tool::{Tool, ToolContext};
use serde_json::json;
use std::fs;
use tempfile::TempDir;

fn create_context(dir: &std::path::Path) -> ToolContext {
    ToolContext::new("ses_test", "msg_test", dir)
}

#[tokio::test]
async fn test_batch_disallowed_tool() {
    let temp = TempDir::new().unwrap();
    let tool = BatchTool;
    let ctx = create_context(temp.path());

    let params = json!({
        "tool_calls": [
            {
                "tool": "batch",
                "parameters": {}
            }
        ]
    });

    let result = tool.execute(params, &ctx).await.unwrap();
    assert!(result.metadata["failed"].as_u64().unwrap() > 0);
}

#[tokio::test]
async fn test_batch_unknown_tool() {
    let temp = TempDir::new().unwrap();
    let tool = BatchTool;
    let ctx = create_context(temp.path());

    let params = json!({
        "tool_calls": [
            {
                "tool": "nonexistent_tool",
                "parameters": {}
            }
        ]
    });

    let result = tool.execute(params, &ctx).await.unwrap();
    assert!(result.metadata["failed"].as_u64().unwrap() > 0);
}

#[tokio::test]
async fn test_batch_multiple_reads() {
    let temp = TempDir::new().unwrap();
    let file1 = temp.path().join("file1.txt");
    let file2 = temp.path().join("file2.txt");
    fs::write(&file1, "content 1").unwrap();
    fs::write(&file2, "content 2").unwrap();

    let tool = BatchTool;
    let ctx = create_context(temp.path());

    let params = json!({
        "tool_calls": [
            {
                "tool": "read",
                "parameters": {
                    "filePath": file1.to_string_lossy()
                }
            },
            {
                "tool": "read",
                "parameters": {
                    "filePath": file2.to_string_lossy()
                }
            }
        ]
    });

    let result = tool.execute(params, &ctx).await.unwrap();
    assert_eq!(result.metadata["successful"].as_u64().unwrap(), 2);
    assert_eq!(result.metadata["failed"].as_u64().unwrap(), 0);
}

// --- Additional tests matching JS batch tool coverage ---

#[tokio::test]
async fn test_batch_disallows_edit_tool() {
    // Mirrors JS behavior: edit tool is disallowed in batch
    let temp = TempDir::new().unwrap();
    let tool = BatchTool;
    let ctx = create_context(temp.path());

    let params = json!({
        "tool_calls": [
            {
                "tool": "edit",
                "parameters": {
                    "filePath": "/tmp/test.txt",
                    "oldString": "a",
                    "newString": "b"
                }
            }
        ]
    });

    let result = tool.execute(params, &ctx).await.unwrap();
    assert!(result.metadata["failed"].as_u64().unwrap() > 0);
}

#[tokio::test]
async fn test_batch_disallows_todoread() {
    // Mirrors JS behavior: todoread is disallowed in batch
    let temp = TempDir::new().unwrap();
    let tool = BatchTool;
    let ctx = create_context(temp.path());

    let params = json!({
        "tool_calls": [
            {
                "tool": "todoread",
                "parameters": {}
            }
        ]
    });

    let result = tool.execute(params, &ctx).await.unwrap();
    assert!(result.metadata["failed"].as_u64().unwrap() > 0);
}

#[tokio::test]
async fn test_batch_mixed_success_and_failure() {
    let temp = TempDir::new().unwrap();
    let file = temp.path().join("exists.txt");
    fs::write(&file, "content").unwrap();

    let tool = BatchTool;
    let ctx = create_context(temp.path());

    let params = json!({
        "tool_calls": [
            {
                "tool": "read",
                "parameters": {
                    "filePath": file.to_string_lossy()
                }
            },
            {
                "tool": "read",
                "parameters": {
                    "filePath": "/nonexistent/file.txt"
                }
            }
        ]
    });

    let result = tool.execute(params, &ctx).await.unwrap();
    assert_eq!(result.metadata["successful"].as_u64().unwrap(), 1);
    assert_eq!(result.metadata["failed"].as_u64().unwrap(), 1);
}

#[test]
fn test_batch_tool_id() {
    let tool = BatchTool;
    assert_eq!(tool.id(), "batch");
}

#[test]
fn test_batch_tool_parameters_schema() {
    let tool = BatchTool;
    let schema = tool.parameters_schema();
    assert!(schema["properties"]["tool_calls"].is_object());
}
