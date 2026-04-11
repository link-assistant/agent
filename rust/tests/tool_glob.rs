//! Tests for the glob tool.
//!
//! Mirrors test coverage from js/tests/integration/glob.tools.test.js
//! and the original inline tests from rust/src/tool/glob.rs.

use agent::tool::glob::GlobTool;
use agent::tool::{Tool, ToolContext};
use serde_json::json;
use std::fs;
use std::path::Path;
use tempfile::TempDir;

fn create_context(dir: &Path) -> ToolContext {
    ToolContext::new("ses_test", "msg_test", dir)
}

#[tokio::test]
async fn test_glob_txt_files() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("file1.txt"), "content").unwrap();
    fs::write(temp.path().join("file2.txt"), "content").unwrap();
    fs::write(temp.path().join("file3.rs"), "content").unwrap();

    let tool = GlobTool;
    let ctx = create_context(temp.path());
    let params = json!({ "pattern": "*.txt" });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("file1.txt"));
    assert!(result.output.contains("file2.txt"));
    assert!(!result.output.contains("file3.rs"));
}

#[tokio::test]
async fn test_glob_recursive() {
    let temp = TempDir::new().unwrap();
    fs::create_dir(temp.path().join("subdir")).unwrap();
    fs::write(temp.path().join("root.txt"), "content").unwrap();
    fs::write(temp.path().join("subdir").join("nested.txt"), "content").unwrap();

    let tool = GlobTool;
    let ctx = create_context(temp.path());
    let params = json!({ "pattern": "**/*.txt" });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("root.txt"));
    assert!(result.output.contains("nested.txt"));
}

#[tokio::test]
async fn test_glob_no_matches() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("file.txt"), "content").unwrap();

    let tool = GlobTool;
    let ctx = create_context(temp.path());
    let params = json!({ "pattern": "*.rs" });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.is_empty());
    assert_eq!(result.metadata["count"], 0);
}

// --- Additional tests matching JS glob tool coverage ---

#[tokio::test]
async fn test_glob_result_has_count_metadata() {
    // Mirrors JS test: glob result contains count metadata
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("a.txt"), "content").unwrap();
    fs::write(temp.path().join("b.txt"), "content").unwrap();

    let tool = GlobTool;
    let ctx = create_context(temp.path());
    let params = json!({ "pattern": "*.txt" });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert_eq!(result.metadata["count"], 2);
}

#[test]
fn test_glob_tool_id() {
    let tool = GlobTool;
    assert_eq!(tool.id(), "glob");
}

#[test]
fn test_glob_tool_parameters_schema() {
    let tool = GlobTool;
    let schema = tool.parameters_schema();
    assert!(schema["properties"]["pattern"].is_object());
}
