//! Tests for the list tool.
//!
//! Mirrors test coverage from js/tests/integration/list.tools.test.js
//! and the original inline tests from rust/src/tool/list.rs.

use link_assistant_agent::tool::list::{should_ignore, ListTool};
use link_assistant_agent::tool::{Tool, ToolContext};
use serde_json::json;
use std::fs;
use std::path::Path;
use tempfile::TempDir;

fn create_context(dir: &Path) -> ToolContext {
    ToolContext::new("ses_test", "msg_test", dir)
}

#[tokio::test]
async fn test_list_directory() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("file1.txt"), "content").unwrap();
    fs::write(temp.path().join("file2.txt"), "more content").unwrap();
    fs::create_dir(temp.path().join("subdir")).unwrap();
    fs::write(temp.path().join("subdir").join("nested.txt"), "nested").unwrap();

    let tool = ListTool;
    let ctx = create_context(temp.path());
    let params = json!({});

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("file1.txt"));
    assert!(result.output.contains("file2.txt"));
    assert!(result.output.contains("subdir"));
    assert!(result.output.contains("nested.txt"));
}

#[tokio::test]
async fn test_list_ignores_node_modules() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("app.js"), "code").unwrap();
    fs::create_dir(temp.path().join("node_modules")).unwrap();
    fs::write(temp.path().join("node_modules").join("pkg.js"), "package").unwrap();

    let tool = ListTool;
    let ctx = create_context(temp.path());
    let params = json!({});

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("app.js"));
    assert!(!result.output.contains("pkg.js"));
}

#[tokio::test]
async fn test_list_nonexistent() {
    let temp = TempDir::new().unwrap();

    let tool = ListTool;
    let ctx = create_context(temp.path());
    let params = json!({ "path": "/nonexistent/path" });

    let result = tool.execute(params, &ctx).await;
    assert!(result.is_err());
}

#[test]
fn test_should_ignore() {
    let patterns = vec![
        "node_modules".to_string(),
        ".git".to_string(),
        "dist".to_string(),
    ];
    assert!(should_ignore("node_modules", &patterns));
    assert!(should_ignore(".git", &patterns));
    assert!(should_ignore("dist", &patterns));
    assert!(!should_ignore("src", &patterns));
    assert!(!should_ignore("main.rs", &patterns));
}

// --- Additional tests matching JS list tool coverage ---

#[tokio::test]
async fn test_list_ignores_git_directory() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("app.rs"), "code").unwrap();
    fs::create_dir(temp.path().join(".git")).unwrap();
    fs::write(temp.path().join(".git").join("config"), "git config").unwrap();

    let tool = ListTool;
    let ctx = create_context(temp.path());
    let params = json!({});

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("app.rs"));
    assert!(!result.output.contains("config"));
}

#[tokio::test]
async fn test_list_ignores_dist_directory() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("src.js"), "code").unwrap();
    fs::create_dir(temp.path().join("dist")).unwrap();
    fs::write(temp.path().join("dist").join("bundle.js"), "bundle").unwrap();

    let tool = ListTool;
    let ctx = create_context(temp.path());
    let params = json!({});

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("src.js"));
    assert!(!result.output.contains("bundle.js"));
}

#[test]
fn test_list_tool_id() {
    let tool = ListTool;
    assert_eq!(tool.id(), "list");
}

#[test]
fn test_list_tool_parameters_schema() {
    let tool = ListTool;
    let schema = tool.parameters_schema();
    // list tool should have path parameter
    assert!(schema["properties"]["path"].is_object());
}
