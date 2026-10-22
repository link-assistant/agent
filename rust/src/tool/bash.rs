//! Bash tool implementation
//!
//! Executes shell commands, matching the JavaScript implementation's bash tool behavior.

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};
use std::process::{ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;
use tokio::time::{timeout, Duration};

use super::{context::ToolContext, Tool, ToolResult};
use crate::error::{AgentError, Result};

/// Default timeout in milliseconds (2 minutes)
const DEFAULT_TIMEOUT_MS: u64 = 120_000;

/// Maximum timeout in milliseconds (10 minutes)
const MAX_TIMEOUT_MS: u64 = 600_000;

/// Output is limited to its last MAX_LINES lines and MAX_BYTES bytes
/// (upstream 307251bf3c, #22660).
const MAX_BYTES: usize = 30_000;
const MAX_LINES: usize = 2000;

/// Prefix of output whose beginning was dropped.
const TRUNCATED: &str = "...output truncated...\n\n";

/// Tool description
const DESCRIPTION: &str = r#"Executes a given bash command in a persistent shell session.

Usage:
- Use for terminal operations like git, npm, docker, etc.
- Commands have a default timeout of 2 minutes (max 10 minutes)
- Output beyond 2000 lines or 30000 bytes is truncated: the beginning is dropped and the end, where errors usually are, is kept
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

        let stdout = Arc::new(Mutex::new(Capture::default()));
        let stderr = Arc::new(Mutex::new(Capture::default()));

        let mut child = Command::new("bash")
            .arg("-c")
            .arg(&params.command)
            .current_dir(&ctx.working_directory)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| AgentError::tool_execution("bash", e.to_string()))?;

        // Read both pipes at once: reading stdout to EOF first deadlocked a
        // command that filled the stderr pipe before closing stdout.
        let out = child.stdout.take();
        let err = child.stderr.take();
        let run = async {
            let (a, b) = tokio::join!(pump(out, stdout.clone()), pump(err, stderr.clone()));
            a?;
            b?;
            child.wait().await
        };
        let result = timeout(timeout_duration, run).await;

        let status = match result {
            Ok(Ok(status)) => Some(status),
            Ok(Err(e)) => return Err(AgentError::tool_execution("bash", e.to_string())),
            Err(_) => {
                let _ = child.kill().await;
                None
            }
        };

        let output = combine(&stdout.lock().unwrap(), &stderr.lock().unwrap());

        let Some(status) = status else {
            // Keep what the command printed before the timeout (upstream
            // 210be4b749, #39559).
            let output = if output.is_empty() {
                format!(
                    "Exit code unavailable\nCommand timed out after {}ms",
                    timeout_ms
                )
            } else {
                format!(
                    "Exit code unavailable\n{}\n\nCommand timed out after {}ms",
                    output, timeout_ms
                )
            };
            return Ok(ToolResult {
                is_error: true,
                title,
                output: output.clone(),
                metadata: json!({
                    "exitCode": null,
                    "exit": null,
                    "output": output,
                    "command": params.command,
                    "timedOut": true,
                }),
                attachments: None,
            });
        };

        // A shell killed by a signal has no exit code; report the signal
        // instead of "-1" (upstream e22c1622e0, #51145).
        let exit_code = status.code();
        let signal = signal_name(status);
        let is_error = exit_code != Some(0);
        let output = match (exit_code, &signal) {
            (Some(0), _) => output,
            (Some(code), _) => format!("Exit code {}\n{}", code, output),
            (None, Some(signal)) => {
                format!("Exit code unavailable (signal {})\n{}", signal, output)
            }
            (None, None) => format!("Exit code unavailable\n{}", output),
        };

        Ok(ToolResult {
            is_error,
            title,
            output: output.clone(),
            metadata: json!({
                "exitCode": exit_code,
                "exit": exit_code,
                "signal": signal,
                "output": output,
                "command": params.command,
            }),
            attachments: None,
        })
    }
}

/// The end of one output stream. At most twice the returned size is kept, so
/// a command that prints without end does not grow memory.
#[derive(Default)]
struct Capture {
    bytes: Vec<u8>,
    dropped: bool,
}

impl Capture {
    fn push(&mut self, data: &[u8]) {
        self.bytes.extend_from_slice(data);
        let keep = MAX_BYTES * 2;
        // Drain in batches so each byte is moved a bounded number of times.
        if self.bytes.len() > keep * 2 {
            let cut = self.bytes.len() - keep;
            self.bytes.drain(..cut);
            self.dropped = true;
        }
    }

    fn text(&self) -> String {
        let mut start = 0;
        if self.dropped {
            // Do not start inside a UTF-8 sequence.
            while start < self.bytes.len() && (self.bytes[start] & 0xC0) == 0x80 {
                start += 1;
            }
        }
        String::from_utf8_lossy(&self.bytes[start..]).into_owned()
    }
}

async fn pump<R: AsyncRead + Unpin>(
    reader: Option<R>,
    capture: Arc<Mutex<Capture>>,
) -> std::io::Result<()> {
    let Some(mut reader) = reader else {
        return Ok(());
    };
    let mut buf = [0u8; 8192];
    loop {
        let n = reader.read(&mut buf).await?;
        if n == 0 {
            return Ok(());
        }
        capture.lock().unwrap().push(&buf[..n]);
    }
}

/// Join stdout and stderr and keep the end of the result.
fn combine(stdout: &Capture, stderr: &Capture) -> String {
    let mut output = stdout.text();
    let err = stderr.text();
    if !err.is_empty() {
        if !output.is_empty() {
            output.push_str("\n--- stderr ---\n");
        }
        output.push_str(&err);
    }
    let (text, cut) = tail(&output, MAX_LINES, MAX_BYTES);
    if cut || stdout.dropped || stderr.dropped {
        format!("{}{}", TRUNCATED, text)
    } else {
        text
    }
}

/// Keep the last `max_lines` lines and `max_bytes` bytes of `text`, cutting
/// at line boundaries and never inside a character (`String::truncate`
/// panicked there).
fn tail(text: &str, max_lines: usize, max_bytes: usize) -> (String, bool) {
    let lines: Vec<&str> = text.split('\n').collect();
    if lines.len() <= max_lines && text.len() <= max_bytes {
        return (text.to_string(), false);
    }
    let mut out: Vec<&str> = Vec::new();
    let mut bytes = 0;
    for line in lines.iter().rev() {
        if out.len() >= max_lines {
            break;
        }
        let size = line.len() + usize::from(!out.is_empty());
        if bytes + size > max_bytes {
            if out.is_empty() {
                let mut start = line.len() - max_bytes;
                while !line.is_char_boundary(start) {
                    start += 1;
                }
                out.push(&line[start..]);
            }
            break;
        }
        out.push(line);
        bytes += size;
    }
    out.reverse();
    (out.join("\n"), true)
}

#[cfg(unix)]
fn signal_name(status: ExitStatus) -> Option<String> {
    use std::os::unix::process::ExitStatusExt;
    // Numbers shared by Linux and macOS.
    let name = match status.signal()? {
        1 => "SIGHUP",
        2 => "SIGINT",
        3 => "SIGQUIT",
        4 => "SIGILL",
        5 => "SIGTRAP",
        6 => "SIGABRT",
        8 => "SIGFPE",
        9 => "SIGKILL",
        11 => "SIGSEGV",
        13 => "SIGPIPE",
        14 => "SIGALRM",
        15 => "SIGTERM",
        other => return Some(other.to_string()),
    };
    Some(name.to_string())
}

#[cfg(not(unix))]
fn signal_name(_status: ExitStatus) -> Option<String> {
    None
}
