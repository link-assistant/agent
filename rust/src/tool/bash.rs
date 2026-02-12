//! Bash tool implementation
//!
//! Executes shell commands, matching the JavaScript implementation's bash tool behavior.

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};
use std::process::Stdio;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

use super::{context::ToolContext, Tool, ToolResult};
use crate::error::{AgentError, Result};

/// Default timeout in milliseconds (2 minutes)
const DEFAULT_TIMEOUT_MS: u64 = 120_000;

/// Maximum timeout in milliseconds (10 minutes)
const MAX_TIMEOUT_MS: u64 = 600_000;

/// Maximum output length before truncation
const MAX_OUTPUT_LENGTH: usize = 30_000;

/// Tool description
const DESCRIPTION: &str = r#"Executes a given bash command in a persistent shell session.

Usage:
- Use for terminal operations like git, npm, docker, etc.
- Commands have a default timeout of 2 minutes (max 10 minutes)
- Output exceeding 30000 characters will be truncated
- Always quote file paths containing spaces"#;

/// Parameters for the bash tool
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BashParams {
    /// The command to execute
    pub command: String,
    /// Optional timeout in milliseconds
    #[serde(default)]
    pub timeout: Option<u64>,
    /// Description of what the command does
    #[serde(default)]
    pub description: Option<String>,
}

/// Bash tool implementation
pub struct BashTool;

#[async_trait]
impl Tool for BashTool {
    fn id(&self) -> &'static str {
        "bash"
    }

    fn description(&self) -> &'static str {
        DESCRIPTION
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The command to execute"
                },
                "timeout": {
                    "type": "number",
                    "description": "Optional timeout in milliseconds (max 600000)"
                },
                "description": {
                    "type": "string",
                    "description": "Description of what this command does"
                }
            },
            "required": ["command"]
        })
    }

    async fn execute(&self, params: Value, ctx: &ToolContext) -> Result<ToolResult> {
        let params: BashParams = serde_json::from_value(params)
            .map_err(|e| AgentError::invalid_arguments("bash", e.to_string()))?;

        let timeout_ms = params
            .timeout
            .unwrap_or(DEFAULT_TIMEOUT_MS)
            .min(MAX_TIMEOUT_MS);
        let timeout_duration = Duration::from_millis(timeout_ms);

        let title = params.description.unwrap_or_else(|| {
            // Extract first part of command for title
            params
                .command
                .split_whitespace()
                .take(3)
                .collect::<Vec<_>>()
                .join(" ")
        });

        // Execute command
        let result = timeout(
            timeout_duration,
            execute_command(&params.command, &ctx.working_directory),
        )
        .await;

        match result {
            Ok(Ok((stdout, stderr, exit_code))) => {
                let mut output = String::new();

                if !stdout.is_empty() {
                    output.push_str(&stdout);
                }

                if !stderr.is_empty() {
                    if !output.is_empty() {
                        output.push_str("\n--- stderr ---\n");
                    }
                    output.push_str(&stderr);
                }

                // Truncate if too long
                if output.len() > MAX_OUTPUT_LENGTH {
                    output.truncate(MAX_OUTPUT_LENGTH);
                    output.push_str("\n... (output truncated)");
                }

                if exit_code != 0 {
                    output.push_str(&format!("\n(exit code: {})", exit_code));
                }

                Ok(ToolResult {
                    title,
                    output,
                    metadata: json!({
                        "exitCode": exit_code,
                        "command": params.command,
                    }),
                    attachments: None,
                })
            }
            Ok(Err(e)) => Err(AgentError::tool_execution("bash", e.to_string())),
            Err(_) => Err(AgentError::tool_execution(
                "bash",
                format!("Command timed out after {}ms", timeout_ms),
            )),
        }
    }
}

/// Execute a shell command and return (stdout, stderr, exit_code)
async fn execute_command(
    command: &str,
    working_dir: &std::path::Path,
) -> std::io::Result<(String, String, i32)> {
    let mut child = Command::new("bash")
        .arg("-c")
        .arg(command)
        .current_dir(working_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let mut stdout = String::new();
    let mut stderr = String::new();

    if let Some(ref mut out) = child.stdout {
        out.read_to_string(&mut stdout).await?;
    }

    if let Some(ref mut err) = child.stderr {
        err.read_to_string(&mut stderr).await?;
    }

    let status = child.wait().await?;
    let exit_code = status.code().unwrap_or(-1);

    Ok((stdout, stderr, exit_code))
}

#[cfg(test)]
mod tests {
    use super::*;
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
}
