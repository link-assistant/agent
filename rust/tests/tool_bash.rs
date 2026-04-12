//! Tests for the bash tool.
//!
//! Mirrors test coverage from js/tests/integration/bash.tools.test.js
//! and the original inline tests from rust/src/tool/bash.rs.

use link_assistant_agent::tool::bash::BashTool;
use link_assistant_agent::tool::{Tool, ToolContext};
use serde_json::json;
use tempfile::TempDir;

fn create_context(dir: &std::path::Path) -> ToolContext {
    ToolContext::new("ses_test", "msg_test", dir)
}

#[tokio::test]
async fn test_bash_echo() {
    let temp = TempDir::new().unwrap();
    let tool = BashTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "command": "echo 'hello world'"
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("hello world"));
    assert_eq!(result.metadata["exitCode"], 0);
}

#[tokio::test]
async fn test_bash_ls() {
    let temp = TempDir::new().unwrap();
    std::fs::write(temp.path().join("test.txt"), "content").unwrap();

    let tool = BashTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "command": "ls"
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("test.txt"));
}

#[tokio::test]
async fn test_bash_exit_code() {
    let temp = TempDir::new().unwrap();
    let tool = BashTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "command": "exit 42"
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert_eq!(result.metadata["exitCode"], 42);
}

#[tokio::test]
async fn test_bash_stderr() {
    let temp = TempDir::new().unwrap();
    let tool = BashTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "command": "echo 'error message' >&2"
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("error message"));
}

#[tokio::test]
async fn test_bash_working_directory() {
    let temp = TempDir::new().unwrap();
    let tool = BashTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "command": "pwd"
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result
        .output
        .trim()
        .ends_with(temp.path().file_name().unwrap().to_str().unwrap()));
}

// --- Additional tests matching JS integration test coverage ---

#[tokio::test]
async fn test_bash_result_has_required_fields() {
    // Mirrors JS test: validates that bash tool result contains all required fields
    // matching the OpenCode JSON output format
    let temp = TempDir::new().unwrap();
    let tool = BashTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "command": "echo hello world"
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    // Validate output contains the command result
    assert!(result.output.contains("hello world"));

    // Validate metadata has required fields (matching JS: metadata.output, metadata.exit)
    assert!(result.metadata.get("exitCode").is_some());
    assert!(result.metadata.get("output").is_some());

    // Validate title is generated
    assert!(!result.title.is_empty());
}

#[tokio::test]
async fn test_bash_multiline_output() {
    let temp = TempDir::new().unwrap();
    let tool = BashTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "command": "echo 'line1'; echo 'line2'; echo 'line3'"
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("line1"));
    assert!(result.output.contains("line2"));
    assert!(result.output.contains("line3"));
}

#[tokio::test]
async fn test_bash_env_variables() {
    let temp = TempDir::new().unwrap();
    let tool = BashTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "command": "export MY_VAR=test123 && echo $MY_VAR"
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("test123"));
}

#[tokio::test]
async fn test_bash_pipe_commands() {
    let temp = TempDir::new().unwrap();
    let tool = BashTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "command": "echo 'hello world' | tr 'a-z' 'A-Z'"
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("HELLO WORLD"));
}

#[test]
fn test_bash_tool_id() {
    let tool = BashTool;
    assert_eq!(tool.id(), "bash");
}

#[test]
fn test_bash_tool_description() {
    let tool = BashTool;
    assert!(!tool.description().is_empty());
}

#[test]
fn test_bash_tool_parameters_schema() {
    let tool = BashTool;
    let schema = tool.parameters_schema();
    assert!(schema["properties"]["command"].is_object());
}
