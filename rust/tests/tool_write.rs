//! Tests for the write tool.
//!
//! Mirrors test coverage from js/tests/integration/write.tools.test.js
//! and the original inline tests from rust/src/tool/write.rs.

use agent::tool::write::WriteTool;
use agent::tool::{Tool, ToolContext};
use serde_json::json;
use std::fs;
use tempfile::TempDir;

fn create_context(dir: &std::path::Path) -> ToolContext {
    ToolContext::new("ses_test", "msg_test", dir)
}

#[tokio::test]
async fn test_write_new_file() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("new_file.txt");

    let tool = WriteTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "content": "Hello, World!",
        "filePath": file_path.to_string_lossy()
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(file_path.exists());
    assert_eq!(fs::read_to_string(&file_path).unwrap(), "Hello, World!");
    assert_eq!(result.metadata["exists"], false);
}

#[tokio::test]
async fn test_write_overwrite_file() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("existing.txt");
    fs::write(&file_path, "old content").unwrap();

    let tool = WriteTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "content": "new content",
        "filePath": file_path.to_string_lossy()
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert_eq!(fs::read_to_string(&file_path).unwrap(), "new content");
    assert_eq!(result.metadata["exists"], true);
}

#[tokio::test]
async fn test_write_creates_directories() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("a").join("b").join("c").join("file.txt");

    let tool = WriteTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "content": "nested content",
        "filePath": file_path.to_string_lossy()
    });

    tool.execute(params, &ctx).await.unwrap();

    assert!(file_path.exists());
    assert_eq!(fs::read_to_string(&file_path).unwrap(), "nested content");
}

// --- Additional tests matching JS write tool coverage ---

#[tokio::test]
async fn test_write_result_has_required_fields() {
    // Mirrors JS test: write tool result has proper metadata
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("test.txt");

    let tool = WriteTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "content": "test content",
        "filePath": file_path.to_string_lossy()
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    // Title should be set
    assert!(!result.title.is_empty());

    // Metadata should have exists field
    assert!(result.metadata.get("exists").is_some());
}

#[tokio::test]
async fn test_write_multiline_content() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("multiline.txt");

    let tool = WriteTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "content": "line1\nline2\nline3\n",
        "filePath": file_path.to_string_lossy()
    });

    tool.execute(params, &ctx).await.unwrap();

    let content = fs::read_to_string(&file_path).unwrap();
    assert_eq!(content, "line1\nline2\nline3\n");
}

#[test]
fn test_write_tool_id() {
    let tool = WriteTool;
    assert_eq!(tool.id(), "write");
}

#[test]
fn test_write_tool_parameters_schema() {
    let tool = WriteTool;
    let schema = tool.parameters_schema();
    assert!(schema["properties"]["filePath"].is_object());
    assert!(schema["properties"]["content"].is_object());
}
