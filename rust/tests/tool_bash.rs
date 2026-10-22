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
    assert!(result.output.starts_with("Exit code 42\n"));
    assert_eq!(serde_json::to_value(&result).unwrap()["isError"], true);
}

#[tokio::test]
async fn test_quiet_process_status() {
    let temp = TempDir::new().unwrap();
    let ctx = create_context(temp.path());
    let failure = BashTool
        .execute(json!({"command": "false"}), &ctx)
        .await
        .unwrap();
    assert_eq!(failure.output, "Exit code 1\n");
    assert_eq!(failure.metadata["exit"], 1);
    assert_eq!(serde_json::to_value(&failure).unwrap()["isError"], true);
    let success = BashTool
        .execute(json!({"command": "true"}), &ctx)
        .await
        .unwrap();
    assert_eq!(success.output, "");
    assert_eq!(serde_json::to_value(&success).unwrap()["isError"], false);
}

#[tokio::test]
async fn test_timeout_status() {
    let temp = TempDir::new().unwrap();
    let result = BashTool
        .execute(
            json!({"command": "exec sleep 2", "timeout": 50}),
            &create_context(temp.path()),
        )
        .await
        .unwrap();
    assert!(result.output.starts_with("Exit code unavailable\n"));
    assert!(result.output.contains("timed out after 50ms"));
    assert_eq!(result.metadata["exit"], serde_json::Value::Null);
    assert_eq!(serde_json::to_value(&result).unwrap()["isError"], true);
}

#[tokio::test]
async fn test_batch_process_failure() {
    let temp = TempDir::new().unwrap();
    let result = link_assistant_agent::tool::batch::BatchTool
        .execute(
            json!({"tool_calls": [{"tool": "bash", "parameters": {"command": "false"}}]}),
            &create_context(temp.path()),
        )
        .await
        .unwrap();
    assert_eq!(result.metadata["successful"], 0);
    assert_eq!(result.metadata["failed"], 1);
    assert_eq!(serde_json::to_value(&result).unwrap()["isError"], true);
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

// Issue #335: the tool read stdout to EOF before reading stderr, so a command
// that filled the stderr pipe (about 64 KiB) before closing stdout hung until
// the timeout.
#[tokio::test]
async fn test_bash_large_stderr_does_not_deadlock() {
    let temp = TempDir::new().unwrap();
    let result = BashTool
        .execute(
            json!({
                "command": "head -c 200000 /dev/zero | tr '\\0' e >&2; echo done",
                "timeout": 10000
            }),
            &create_context(temp.path()),
        )
        .await
        .unwrap();
    assert!(
        !result.is_error,
        "{}",
        result.output.chars().take(200).collect::<String>()
    );
    assert!(!result.output.contains("timed out"));
    assert_eq!(result.metadata["exit"], 0);
    // Truncation keeps the end of the combined output: the stderr tail.
    assert!(result.output.ends_with('e'));
}

// Issue #335: `String::truncate` panicked when byte 30000 fell inside a
// multi-byte character.
#[tokio::test]
async fn test_bash_truncation_respects_utf8_boundaries() {
    let temp = TempDir::new().unwrap();
    let result = BashTool
        .execute(
            json!({"command": "printf a; yes é | head -n 15000 | tr -d '\\n'"}),
            &create_context(temp.path()),
        )
        .await
        .unwrap();
    assert!(result.output.starts_with("...output truncated...\n\n"));
    assert!(result.output.ends_with('é'));
    assert!(!result.output.contains('\u{FFFD}'));
    assert!(result.output.len() <= 30_000 + "...output truncated...\n\n".len());
}

// Issue #335: truncation keeps the end of the output, where errors are
// printed, and drops the beginning (upstream 307251bf3c, #22660).
#[tokio::test]
async fn test_bash_truncation_keeps_the_tail() {
    let temp = TempDir::new().unwrap();
    let result = BashTool
        .execute(
            json!({"command": "seq 1 5000; echo FINAL-ERROR-LINE; exit 3"}),
            &create_context(temp.path()),
        )
        .await
        .unwrap();
    assert!(result
        .output
        .starts_with("Exit code 3\n...output truncated...\n\n"));
    assert!(result.output.ends_with("FINAL-ERROR-LINE\n"));
    assert!(!result.output.contains("\n1\n2\n3\n"));
    assert!(result.output.lines().count() <= 2003);
    assert_eq!(result.metadata["exit"], 3);
}

// Issue #335: a timed-out command keeps the output it printed before the
// timeout (upstream 210be4b749, #39559).
#[tokio::test]
async fn test_bash_timeout_keeps_partial_output() {
    let temp = TempDir::new().unwrap();
    let result = BashTool
        .execute(
            json!({"command": "echo before-timeout; exec sleep 5", "timeout": 500}),
            &create_context(temp.path()),
        )
        .await
        .unwrap();
    assert!(result.output.starts_with("Exit code unavailable\n"));
    assert!(result.output.contains("before-timeout"));
    assert!(result.output.contains("timed out after 500ms"));
    assert_eq!(result.metadata["exit"], serde_json::Value::Null);
}

// Issue #335: a shell killed by a signal reported "Exit code -1" (upstream
// e22c1622e0, #51145).
#[cfg(unix)]
#[tokio::test]
async fn test_bash_signal_is_reported() {
    let temp = TempDir::new().unwrap();
    let result = BashTool
        .execute(
            json!({"command": "kill -9 $$"}),
            &create_context(temp.path()),
        )
        .await
        .unwrap();
    assert!(result.is_error);
    assert!(
        result
            .output
            .starts_with("Exit code unavailable (signal SIGKILL)\n"),
        "{}",
        result.output
    );
    assert_eq!(result.metadata["exit"], serde_json::Value::Null);
    assert_eq!(result.metadata["signal"], "SIGKILL");
}
