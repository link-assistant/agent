//! Tests for the read tool.
//!
//! Mirrors test coverage from js/tests/integration/read.tools.test.js
//! and the original inline tests from rust/src/tool/read.rs.

use link_assistant_agent::tool::read::ReadTool;
use link_assistant_agent::tool::{Tool, ToolContext};
use serde_json::json;
use std::fs;
use std::path::Path;
use tempfile::TempDir;

fn create_context(dir: &Path) -> ToolContext {
    ToolContext::new("ses_test", "msg_test", dir)
}

#[tokio::test]
async fn test_read_text_file() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("test.txt");
    fs::write(&file_path, "line 1\nline 2\nline 3\n").unwrap();

    let tool = ReadTool;
    let ctx = create_context(temp.path());
    let params = json!({ "filePath": file_path.to_string_lossy() });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("line 1"));
    assert!(result.output.contains("line 2"));
    assert!(result.output.contains("line 3"));
    assert!(result.output.contains("00001|"));
}

#[tokio::test]
async fn test_read_with_offset_and_limit() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("test.txt");
    let content: String = (1..=100).map(|i| format!("line {}\n", i)).collect();
    fs::write(&file_path, content).unwrap();

    let tool = ReadTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "filePath": file_path.to_string_lossy(),
        "offset": 10,
        "limit": 5
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("line 11"));
    assert!(result.output.contains("line 15"));
    assert!(!result.output.contains("line 16"));
}

#[tokio::test]
async fn test_read_nonexistent_file() {
    let temp = TempDir::new().unwrap();
    let tool = ReadTool;
    let ctx = create_context(temp.path());
    let params = json!({ "filePath": "/nonexistent/file.txt" });

    let result = tool.execute(params, &ctx).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_read_binary_file() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("test.bin");
    fs::write(&file_path, [0, 1, 2, 3, 0, 0, 0]).unwrap();

    let tool = ReadTool;
    let ctx = create_context(temp.path());
    let params = json!({ "filePath": file_path.to_string_lossy() });

    let result = tool.execute(params, &ctx).await;
    assert!(result.is_err());
}

// --- Additional tests matching JS read tool coverage ---

#[tokio::test]
async fn test_read_result_has_preview_metadata() {
    // Mirrors JS test: read tool result contains preview metadata
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("test.txt");
    fs::write(&file_path, "hello world\n").unwrap();

    let tool = ReadTool;
    let ctx = create_context(temp.path());
    let params = json!({ "filePath": file_path.to_string_lossy() });

    let result = tool.execute(params, &ctx).await.unwrap();

    // Validate title is set
    assert!(!result.title.is_empty());

    // Validate output contains line-numbered content
    assert!(result.output.contains("hello world"));
}

#[tokio::test]
async fn test_read_empty_file() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("empty.txt");
    fs::write(&file_path, "").unwrap();

    let tool = ReadTool;
    let ctx = create_context(temp.path());
    let params = json!({ "filePath": file_path.to_string_lossy() });

    // Empty file should not error - it may return empty or a status message
    let result = tool.execute(params, &ctx).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_read_with_line_numbers() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("test.txt");
    fs::write(&file_path, "alpha\nbeta\ngamma\n").unwrap();

    let tool = ReadTool;
    let ctx = create_context(temp.path());
    let params = json!({ "filePath": file_path.to_string_lossy() });

    let result = tool.execute(params, &ctx).await.unwrap();

    // Check line numbers are present (5-digit zero-padded format)
    assert!(result.output.contains("00001|"));
    assert!(result.output.contains("00002|"));
    assert!(result.output.contains("00003|"));
}

#[tokio::test]
async fn test_read_long_file_default_includes_first_and_last_ranges() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("long-file.txt");
    let content = (1..=2105)
        .map(|line| format!("line {}", line))
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(&file_path, content).unwrap();

    let tool = ReadTool;
    let ctx = create_context(temp.path());
    let params = json!({ "filePath": file_path.to_string_lossy() });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("00001| line 1"));
    assert!(result.output.contains("02105| line 2105"));
    assert!(result.output.contains("... [omitted lines 1001..1105] ..."));
    assert!(!result.output.contains("01050| line 1050"));
}

#[tokio::test]
async fn test_read_long_single_line_includes_omitted_column_range() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("long-line.txt");
    fs::write(&file_path, format!("START{}END", "m".repeat(3000))).unwrap();

    let tool = ReadTool;
    let ctx = create_context(temp.path());
    let params = json!({ "filePath": file_path.to_string_lossy() });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("00001| START"));
    assert!(result.output.contains("END"));
    assert!(result
        .output
        .contains("[omitted columns 1001..2008 of line 1]"));
}

#[tokio::test]
async fn test_read_explicit_column_window() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("columns.txt");
    fs::write(
        &file_path,
        format!("{}TARGET{}", "A".repeat(10), "B".repeat(10)),
    )
    .unwrap();

    let tool = ReadTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "filePath": file_path.to_string_lossy(),
        "columnOffset": 10,
        "columnLimit": 6
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains(
        "00001| [omitted columns 1..10 of line 1] ... TARGET ... [omitted columns 17..26 of line 1]"
    ));
    assert!(!result.output.contains("AAAAATARGET"));
    assert!(!result.output.contains("TARGETBBBBB"));
}

#[test]
fn test_read_tool_id() {
    let tool = ReadTool;
    assert_eq!(tool.id(), "read");
}

#[test]
fn test_read_tool_parameters_schema() {
    let tool = ReadTool;
    let schema = tool.parameters_schema();
    assert!(schema["properties"]["filePath"].is_object());
}
