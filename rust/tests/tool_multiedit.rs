//! Tests for the multiedit tool.
//!
//! Mirrors test coverage from js/src/tool/multiedit.ts behavior
//! and the original inline tests from rust/src/tool/multiedit.rs.

use agent::tool::multiedit::MultiEditTool;
use agent::tool::{Tool, ToolContext};
use serde_json::json;
use std::fs;
use tempfile::TempDir;

fn create_context(dir: &std::path::Path) -> ToolContext {
    ToolContext::new("ses_test", "msg_test", dir)
}

#[tokio::test]
async fn test_multiedit_sequential() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("test.txt");
    fs::write(&file_path, "hello world foo bar").unwrap();

    let tool = MultiEditTool;
    let ctx = create_context(temp.path());

    let params = json!({
        "filePath": file_path.to_string_lossy(),
        "edits": [
            {
                "filePath": file_path.to_string_lossy(),
                "oldString": "hello",
                "newString": "greetings"
            },
            {
                "filePath": file_path.to_string_lossy(),
                "oldString": "foo",
                "newString": "baz"
            }
        ]
    });

    tool.execute(params, &ctx).await.unwrap();

    let content = fs::read_to_string(&file_path).unwrap();
    assert_eq!(content, "greetings world baz bar");
}

// --- Additional tests matching JS multiedit behavior ---

#[tokio::test]
async fn test_multiedit_single_edit() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("test.txt");
    fs::write(&file_path, "hello world").unwrap();

    let tool = MultiEditTool;
    let ctx = create_context(temp.path());

    let params = json!({
        "filePath": file_path.to_string_lossy(),
        "edits": [
            {
                "filePath": file_path.to_string_lossy(),
                "oldString": "hello",
                "newString": "goodbye"
            }
        ]
    });

    tool.execute(params, &ctx).await.unwrap();

    let content = fs::read_to_string(&file_path).unwrap();
    assert_eq!(content, "goodbye world");
}

#[tokio::test]
async fn test_multiedit_result_has_metadata() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("test.txt");
    fs::write(&file_path, "aaa bbb ccc").unwrap();

    let tool = MultiEditTool;
    let ctx = create_context(temp.path());

    let params = json!({
        "filePath": file_path.to_string_lossy(),
        "edits": [
            {
                "filePath": file_path.to_string_lossy(),
                "oldString": "aaa",
                "newString": "xxx"
            },
            {
                "filePath": file_path.to_string_lossy(),
                "oldString": "ccc",
                "newString": "zzz"
            }
        ]
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    // Result should have metadata about all edits
    assert!(result.metadata.get("results").is_some());
}

#[test]
fn test_multiedit_tool_id() {
    let tool = MultiEditTool;
    assert_eq!(tool.id(), "multiedit");
}
