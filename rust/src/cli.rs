//! CLI module for the Agent
//!
//! Handles command-line argument parsing and the main execution flow,
//! matching the JavaScript implementation's CLI interface.

use clap::Parser;
use serde::{Deserialize, Serialize};
use std::io::{self, BufRead};
use std::path::PathBuf;

use crate::error::{AgentError, Result};
use crate::id::{ascending, Prefix};
use crate::tool::{ToolContext, ToolRegistry};

/// Agent CLI - A minimal AI CLI agent compatible with OpenCode's JSON interface
#[derive(Parser, Debug)]
#[command(name = "agent")]
#[command(author, version, about, long_about = None)]
pub struct Args {
    /// Model to use in format providerID/modelID
    #[arg(long, default_value = "opencode/kimi-k2.5-free")]
    pub model: String,

    /// JSON output format standard
    #[arg(long, default_value = "opencode", value_parser = ["opencode", "claude"])]
    pub json_standard: String,

    /// Direct prompt (bypasses stdin reading)
    #[arg(short = 'p', long)]
    pub prompt: Option<String>,

    /// System message override
    #[arg(long)]
    pub system_message: Option<String>,

    /// Append to system message
    #[arg(long)]
    pub append_system_message: Option<String>,

    /// Enable verbose mode
    #[arg(long, default_value = "false")]
    pub verbose: bool,

    /// Dry run mode (simulate without API calls)
    #[arg(long, default_value = "false")]
    pub dry_run: bool,

    /// Output compact JSON (single line)
    #[arg(long, default_value = "false")]
    pub compact_json: bool,

    /// Working directory
    #[arg(long)]
    pub working_directory: Option<PathBuf>,
}

/// JSON input format
#[derive(Debug, Deserialize)]
pub struct InputMessage {
    pub message: String,
    #[serde(default)]
    pub tools: Option<Vec<ToolCall>>,
}

/// Tool call from input
#[derive(Debug, Deserialize)]
pub struct ToolCall {
    pub name: String,
    pub params: serde_json::Value,
}

/// Output event types
#[derive(Debug, Serialize)]
#[serde(tag = "type")]
pub enum OutputEvent {
    #[serde(rename = "status")]
    Status {
        mode: String,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        hint: Option<String>,
    },
    #[serde(rename = "step_start")]
    StepStart {
        timestamp: u64,
        #[serde(rename = "sessionID")]
        session_id: String,
    },
    #[serde(rename = "text")]
    Text {
        timestamp: u64,
        #[serde(rename = "sessionID")]
        session_id: String,
        text: String,
    },
    #[serde(rename = "tool_use")]
    ToolUse {
        timestamp: u64,
        #[serde(rename = "sessionID")]
        session_id: String,
        tool: String,
        result: serde_json::Value,
    },
    #[serde(rename = "step_finish")]
    StepFinish {
        timestamp: u64,
        #[serde(rename = "sessionID")]
        session_id: String,
        reason: String,
    },
    #[serde(rename = "error")]
    Error {
        timestamp: u64,
        #[serde(rename = "sessionID")]
        session_id: Option<String>,
        error: serde_json::Value,
    },
}

/// Output an event to stdout
fn output_event(event: &OutputEvent, compact: bool) {
    let json = if compact {
        serde_json::to_string(event)
    } else {
        serde_json::to_string_pretty(event)
    };

    if let Ok(json) = json {
        println!("{}", json);
    }
}

/// Get current timestamp in milliseconds
fn timestamp_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

/// Run the CLI with parsed arguments
pub async fn run(args: Args) -> Result<()> {
    let working_dir = args
        .working_directory
        .clone()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    // Handle direct prompt mode
    if let Some(ref prompt) = args.prompt {
        return run_with_input(&args, &working_dir, prompt).await;
    }

    // Output status
    output_event(
        &OutputEvent::Status {
            mode: "stdin-stream".to_string(),
            message: "Agent CLI (Rust) ready. Accepts JSON and plain text input.".to_string(),
            hint: Some("Press CTRL+C to exit.".to_string()),
        },
        args.compact_json,
    );

    // Read from stdin
    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        match line {
            Ok(input) => {
                let trimmed = input.trim();
                if trimmed.is_empty() {
                    continue;
                }

                // Try to parse as JSON, otherwise treat as plain text
                let message = match serde_json::from_str::<InputMessage>(trimmed) {
                    Ok(msg) => msg.message,
                    Err(_) => trimmed.to_string(),
                };

                if let Err(e) = run_with_input(&args, &working_dir, &message).await {
                    output_event(
                        &OutputEvent::Error {
                            timestamp: timestamp_ms(),
                            session_id: None,
                            error: e.to_json(),
                        },
                        args.compact_json,
                    );
                }
            }
            Err(e) => {
                output_event(
                    &OutputEvent::Error {
                        timestamp: timestamp_ms(),
                        session_id: None,
                        error: serde_json::json!({
                            "name": "IOError",
                            "data": { "message": e.to_string() }
                        }),
                    },
                    args.compact_json,
                );
            }
        }
    }

    Ok(())
}

/// Run with a specific input message
async fn run_with_input(args: &Args, working_dir: &PathBuf, message: &str) -> Result<()> {
    let session_id = ascending(Prefix::Session, None);
    let message_id = ascending(Prefix::Message, None);

    // Output step start
    output_event(
        &OutputEvent::StepStart {
            timestamp: timestamp_ms(),
            session_id: session_id.clone(),
        },
        args.compact_json,
    );

    if args.dry_run {
        // In dry run mode, just echo the message
        output_event(
            &OutputEvent::Text {
                timestamp: timestamp_ms(),
                session_id: session_id.clone(),
                text: format!("[DRY RUN] Received message: {}", message),
            },
            args.compact_json,
        );
    } else {
        // Create tool context
        let ctx = ToolContext::new(&session_id, &message_id, working_dir);

        // Initialize tool registry
        let registry = ToolRegistry::new();

        // For now, just output a simple response
        // In a full implementation, this would call the LLM API
        output_event(
            &OutputEvent::Text {
                timestamp: timestamp_ms(),
                session_id: session_id.clone(),
                text: format!(
                    "Agent (Rust) ready. {} tools available. Message: {}",
                    registry.all().len(),
                    message
                ),
            },
            args.compact_json,
        );

        // List available tools
        let tools: Vec<&str> = registry.all().iter().map(|t| t.id()).collect();
        output_event(
            &OutputEvent::Text {
                timestamp: timestamp_ms(),
                session_id: session_id.clone(),
                text: format!("Available tools: {}", tools.join(", ")),
            },
            args.compact_json,
        );
    }

    // Output step finish
    output_event(
        &OutputEvent::StepFinish {
            timestamp: timestamp_ms(),
            session_id,
            reason: "stop".to_string(),
        },
        args.compact_json,
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_json_input() {
        let input = r#"{"message": "hello world"}"#;
        let msg: InputMessage = serde_json::from_str(input).unwrap();
        assert_eq!(msg.message, "hello world");
    }

    #[test]
    fn test_args_defaults() {
        let args = Args::parse_from(["agent"]);
        assert_eq!(args.model, "opencode/kimi-k2.5-free");
        assert_eq!(args.json_standard, "opencode");
        assert!(!args.verbose);
        assert!(!args.dry_run);
    }

    #[test]
    fn test_args_with_prompt() {
        let args = Args::parse_from(["agent", "-p", "hello"]);
        assert_eq!(args.prompt, Some("hello".to_string()));
    }
}
