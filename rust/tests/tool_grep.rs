//! Tests for the grep tool.
//!
//! Mirrors test coverage from js/tests/integration/grep.tools.test.js
//! and the original inline tests from rust/src/tool/grep.rs.

use link_assistant_agent::tool::grep::{matches_glob, GrepTool};
use link_assistant_agent::tool::{Tool, ToolContext};
use serde_json::json;
use std::fs;
use std::path::Path;
use tempfile::TempDir;

fn create_context(dir: &Path) -> ToolContext {
    ToolContext::new("ses_test", "msg_test", dir)
}

#[tokio::test]
async fn test_grep_simple() {
    let temp = TempDir::new().unwrap();
    fs::write(
        temp.path().join("test.txt"),
        "hello world\nfoo bar\nhello again",
    )
    .unwrap();

    let tool = GrepTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "pattern": "hello",
        "output_mode": "content"
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("hello world"));
    assert!(result.output.contains("hello again"));
    assert!(!result.output.contains("foo bar"));
}

#[tokio::test]
async fn test_grep_files_with_matches() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("match.txt"), "hello world").unwrap();
    fs::write(temp.path().join("no_match.txt"), "goodbye world").unwrap();

    let tool = GrepTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "pattern": "hello",
        "output_mode": "files_with_matches"
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("match.txt"));
    assert!(!result.output.contains("no_match.txt"));
}

#[tokio::test]
async fn test_grep_case_insensitive() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("test.txt"), "Hello World\nHELLO WORLD").unwrap();

    let tool = GrepTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "pattern": "hello",
        "-i": true,
        "output_mode": "content"
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("Hello World"));
    assert!(result.output.contains("HELLO WORLD"));
}

#[test]
fn test_glob_matching() {
    assert!(matches_glob("file.js", "*.js"));
    assert!(!matches_glob("file.ts", "*.js"));
    assert!(matches_glob("file.tsx", "**/*.tsx"));
}

// --- Additional tests matching JS grep tool coverage ---

#[tokio::test]
async fn test_grep_count_mode() {
    let temp = TempDir::new().unwrap();
    fs::write(
        temp.path().join("test.txt"),
        "hello world\nfoo bar\nhello again",
    )
    .unwrap();

    let tool = GrepTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "pattern": "hello",
        "output_mode": "count"
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    // Count mode should show match counts
    assert!(!result.output.is_empty());
}

#[tokio::test]
async fn test_grep_no_matches() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("test.txt"), "hello world").unwrap();

    let tool = GrepTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "pattern": "nonexistent_pattern_xyz",
        "output_mode": "content"
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.is_empty());
}

#[tokio::test]
async fn test_grep_regex_pattern() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("test.txt"), "foo123\nbar456\nbaz").unwrap();

    let tool = GrepTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "pattern": "\\d+",
        "output_mode": "content"
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("foo123"));
    assert!(result.output.contains("bar456"));
    assert!(!result.output.contains("baz"));
}

#[tokio::test]
async fn test_grep_long_matching_line_is_summarized_around_match() {
    let temp = TempDir::new().unwrap();
    fs::write(
        temp.path().join("long-match.txt"),
        format!(
            "{}ivu-modal-header{{cursor:move}}{}",
            "x".repeat(1500),
            "y".repeat(1500)
        ),
    )
    .unwrap();

    let tool = GrepTool;
    let ctx = create_context(temp.path());
    let params = json!({
        "pattern": "ivu-modal-header",
        "path": temp.path().to_string_lossy(),
        "glob": "*.txt",
        "output_mode": "content"
    });

    let result = tool.execute(params, &ctx).await.unwrap();

    assert!(result.output.contains("ivu-modal-header{cursor:move}"));
    assert!(result.output.contains("[omitted columns 1..508 of line 1]"));
    assert!(result
        .output
        .contains("[omitted columns 2509..3029 of line 1]"));
    assert!(result.output.len() < 2300);
}

#[test]
fn test_grep_tool_id() {
    let tool = GrepTool;
    assert_eq!(tool.id(), "grep");
}

#[test]
fn test_grep_tool_parameters_schema() {
    let tool = GrepTool;
    let schema = tool.parameters_schema();
    assert!(schema["properties"]["pattern"].is_object());
}

// grep reliability fixes ported from upstream OpenCode (issue #335).

#[tokio::test]
async fn test_grep_searches_hidden_files() {
    // upstream #7501: `.github/` and other dotfiles are searched.
    let temp = TempDir::new().unwrap();
    fs::create_dir(temp.path().join(".github")).unwrap();
    fs::write(temp.path().join(".github").join("ci.yml"), "needle: true\n").unwrap();
    fs::write(temp.path().join(".env.example"), "needle=1\n").unwrap();

    let tool = GrepTool;
    let ctx = create_context(temp.path());
    let params = json!({ "pattern": "needle" });

    let result = tool.execute(params, &ctx).await.unwrap();
    assert!(result.output.contains("ci.yml"), "{}", result.output);
    assert!(result.output.contains(".env.example"), "{}", result.output);
}

#[tokio::test]
async fn test_grep_skips_git_directory() {
    let temp = TempDir::new().unwrap();
    fs::create_dir(temp.path().join(".git")).unwrap();
    fs::write(temp.path().join(".git").join("config"), "needle\n").unwrap();

    let tool = GrepTool;
    let ctx = create_context(temp.path());
    let params = json!({ "pattern": "needle" });

    let result = tool.execute(params, &ctx).await.unwrap();
    assert!(!result.output.contains("config"), "{}", result.output);
}
