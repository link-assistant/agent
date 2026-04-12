//! Tests for the edit tool.
//!
//! Mirrors test coverage from js/tests/integration/edit.tools.test.js
//! and the original inline tests from rust/src/tool/edit.rs.

use link_assistant_agent::tool::edit::{
    try_context_aware_replace, try_escape_normalized_replace, try_exact_replace,
    try_indentation_flexible_replace, try_multi_occurrence_replace, try_trimmed_boundary_replace,
    EditTool,
};
use link_assistant_agent::tool::{Tool, ToolContext};
use serde_json::json;
use std::fs;
use tempfile::TempDir;

fn create_context(dir: &std::path::Path) -> ToolContext {
    ToolContext::new("ses_test", "msg_test", dir)
}

// --- Tool execute tests ---

#[tokio::test]
async fn test_edit_exact_match() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("test.txt");
    fs::write(&file_path, "hello world").unwrap();

    let tool = EditTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "filePath": file_path.to_string_lossy(),
        "oldString": "world",
        "newString": "rust"
    });

    tool.execute(params, &ctx).await.unwrap();

    let content = fs::read_to_string(&file_path).unwrap();
    assert_eq!(content, "hello rust");
}

#[tokio::test]
async fn test_edit_replace_all() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("test.txt");
    fs::write(&file_path, "foo bar foo baz foo").unwrap();

    let tool = EditTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "filePath": file_path.to_string_lossy(),
        "oldString": "foo",
        "newString": "qux",
        "replaceAll": true
    });

    tool.execute(params, &ctx).await.unwrap();

    let content = fs::read_to_string(&file_path).unwrap();
    assert_eq!(content, "qux bar qux baz qux");
}

#[tokio::test]
async fn test_edit_same_string_error() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("test.txt");
    fs::write(&file_path, "hello").unwrap();

    let tool = EditTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "filePath": file_path.to_string_lossy(),
        "oldString": "hello",
        "newString": "hello"
    });

    let result = tool.execute(params, &ctx).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_edit_create_new_file() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("new_file.txt");

    let tool = EditTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "filePath": file_path.to_string_lossy(),
        "oldString": "",
        "newString": "new content"
    });

    tool.execute(params, &ctx).await.unwrap();

    let content = fs::read_to_string(&file_path).unwrap();
    assert_eq!(content, "new content");
}

// --- Replacement strategy unit tests ---

#[test]
fn test_exact_replace() {
    let content = "hello world";
    let result = try_exact_replace(content, "world", "rust", false);
    assert_eq!(result, Some("hello rust".to_string()));
}

#[test]
fn test_multiple_matches_without_replace_all() {
    let content = "foo bar foo";
    let result = try_exact_replace(content, "foo", "baz", false);
    assert_eq!(result, None);
}

#[test]
fn test_replace_all() {
    let content = "foo bar foo";
    let result = try_exact_replace(content, "foo", "baz", true);
    assert_eq!(result, Some("baz bar baz".to_string()));
}

#[test]
fn test_indentation_flexible() {
    let content = "    fn hello() {\n        println!(\"hi\");\n    }";
    let old = "fn hello() {\n    println!(\"hi\");\n}";
    let result = try_indentation_flexible_replace(content, old, "fn world() {}", false);
    assert!(result.is_some());
}

#[test]
fn test_escape_normalized() {
    let content = "let msg = \"hello\\nworld\";";
    let result = try_escape_normalized_replace(content, "hello", "goodbye", false);
    assert!(result.is_some());
}

#[test]
fn test_trimmed_boundary() {
    let content = "  hello world  ";
    let old = "  hello world  ";
    let _result = try_trimmed_boundary_replace(content, old, "goodbye", false);
    let old2 = "  hello world  \n  ";
    let _result2 = try_trimmed_boundary_replace(content, old2, "goodbye", false);
    // Just ensure no panic
}

#[test]
fn test_context_aware() {
    let content = "fn foo() {\n    let x = 1;\n    x + 1\n}";
    let old = "fn foo() {\n    let x = 1;\n    x + 1\n}";
    let result = try_context_aware_replace(content, old, "fn bar() {}", false);
    assert!(result.is_some());
}

#[test]
fn test_multi_occurrence_replace() {
    let content = "foo bar foo baz foo";
    let result = try_multi_occurrence_replace(content, "foo", "qux");
    assert_eq!(result, Some("qux bar qux baz qux".to_string()));
}

// --- Additional tests matching JS edit tool behavior ---

#[tokio::test]
async fn test_edit_result_has_metadata() {
    // Mirrors JS test: edit result contains diff metadata (diagnostics, diff, filediff)
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("test.txt");
    fs::write(&file_path, "Hello World\n").unwrap();

    let tool = EditTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "filePath": file_path.to_string_lossy(),
        "oldString": "Hello",
        "newString": "Hi"
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    // Validate metadata has required fields matching JS output
    assert!(result.metadata.get("diagnostics").is_some());
    assert!(result.metadata.get("diff").is_some());
    assert!(result.metadata.get("filediff").is_some());

    // Validate filediff structure
    let filediff = &result.metadata["filediff"];
    assert!(filediff.get("file").is_some());
    assert!(filediff.get("before").is_some());
    assert!(filediff.get("after").is_some());
    assert!(filediff.get("additions").is_some());
    assert!(filediff.get("deletions").is_some());

    // Verify file was actually edited
    let content = fs::read_to_string(&file_path).unwrap();
    assert!(content.contains("Hi World"));
}

#[tokio::test]
async fn test_edit_nonexistent_file_with_old_string_errors() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("nonexistent.txt");

    let tool = EditTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "filePath": file_path.to_string_lossy(),
        "oldString": "something",
        "newString": "else"
    });

    let result = tool.execute(params, &ctx).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_edit_preserves_line_endings() {
    let temp = TempDir::new().unwrap();
    let file_path = temp.path().join("test.txt");
    fs::write(&file_path, "line1\nline2\nline3\n").unwrap();

    let tool = EditTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "filePath": file_path.to_string_lossy(),
        "oldString": "line2",
        "newString": "replaced"
    });

    tool.execute(params, &ctx).await.unwrap();

    let content = fs::read_to_string(&file_path).unwrap();
    assert_eq!(content, "line1\nreplaced\nline3\n");
}

#[test]
fn test_edit_tool_id() {
    let tool = EditTool;
    assert_eq!(tool.id(), "edit");
}

#[test]
fn test_edit_tool_parameters_schema() {
    let tool = EditTool;
    let schema = tool.parameters_schema();
    assert!(schema["properties"]["filePath"].is_object());
    assert!(schema["properties"]["oldString"].is_object());
    assert!(schema["properties"]["newString"].is_object());
}
