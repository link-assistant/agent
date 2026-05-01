//! CLI module for the Agent
//!
//! Handles command-line argument parsing and the main execution flow,
//! matching the JavaScript implementation's CLI interface.

use clap::Parser;
use serde::{Deserialize, Serialize};
use std::io::{self, BufRead};
use std::path::PathBuf;

pub use crate::defaults::{
    default_compaction_model, default_compaction_models, default_compaction_safety_margin_percent,
    default_model, DEFAULT_COMPACTION_MODEL, DEFAULT_COMPACTION_MODELS,
    DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT, DEFAULT_MODEL,
};
use crate::error::{AgentError, Result};
use crate::id::{ascending, Prefix};
use crate::tool::{ToolContext, ToolRegistry};

/// Agent CLI - A minimal AI CLI agent compatible with OpenCode's JSON interface
#[derive(Parser, Debug)]
#[command(name = "agent")]
#[command(author, version, about, long_about = None)]
pub struct Args {
    /// Model to use in format providerID/modelID
    #[arg(long, default_value_t = default_model())]
    pub model: String,

    /// JSON output format standard: "opencode" (default) or "claude" (experimental)
    #[arg(long, default_value = "opencode", value_parser = ["opencode", "claude"])]
    pub json_standard: String,

    /// Claude-compatible output format alias: "json" or "stream-json"
    #[arg(long, value_parser = ["json", "stream-json"])]
    pub output_format: Option<String>,

    /// Input format: "text" (default) or Claude-compatible "stream-json" JSONL frames
    #[arg(long, default_value = "text", value_parser = ["text", "stream-json"])]
    pub input_format: String,

    /// Full override of the system message
    #[arg(long)]
    pub system_message: Option<String>,

    /// Full override of the system message from file
    #[arg(long)]
    pub system_message_file: Option<String>,

    /// Append to the default system message
    #[arg(long)]
    pub append_system_message: Option<String>,

    /// Append to the default system message from file
    #[arg(long)]
    pub append_system_message_file: Option<String>,

    /// Run in server mode (default: true). Use --no-server to disable.
    #[arg(long)]
    server: bool,
    #[arg(long = "no-server", hide = true)]
    no_server: bool,

    /// Enable verbose mode to debug API requests (shows system prompt, token counts, etc.)
    #[arg(long)]
    pub verbose: bool,

    /// Simulate operations without making actual API calls or package installations (useful for testing)
    #[arg(long)]
    pub dry_run: bool,

    /// Use existing Claude OAuth credentials from ~/.claude/.credentials.json (from Claude Code CLI)
    #[arg(long)]
    pub use_existing_claude_oauth: bool,

    /// Prompt message to send directly (bypasses stdin reading)
    #[arg(short = 'p', long)]
    pub prompt: Option<String>,

    /// Disable stdin streaming mode (requires --prompt or shows help)
    #[arg(long)]
    pub disable_stdin: bool,

    /// Optional timeout in milliseconds for stdin reading (default: no timeout)
    #[arg(long)]
    pub stdin_stream_timeout: Option<u64>,

    /// Enable auto-merging of rapidly arriving input lines into single messages (default: true).
    /// Use --no-auto-merge-queued-messages to disable.
    #[arg(long)]
    auto_merge_queued_messages: bool,
    #[arg(long = "no-auto-merge-queued-messages", hide = true)]
    no_auto_merge_queued_messages: bool,

    /// Enable interactive mode to accept manual input as plain text strings (default: true).
    /// Use --no-interactive to only accept JSON input.
    #[arg(long)]
    interactive: bool,
    #[arg(long = "no-interactive", hide = true)]
    no_interactive: bool,

    /// Keep accepting stdin input even after the agent finishes work (default: true).
    /// Use --no-always-accept-stdin for single-message mode.
    #[arg(long)]
    always_accept_stdin: bool,
    #[arg(long = "no-always-accept-stdin", hide = true)]
    no_always_accept_stdin: bool,

    /// Output compact JSON (single line) instead of pretty-printed JSON (default: false).
    /// Useful for program-to-program communication.
    #[arg(long)]
    pub compact_json: bool,

    /// Resume a specific session by ID. By default, forks the session with a new UUID.
    /// Use --no-fork to continue in the same session.
    #[arg(short = 'r', long)]
    pub resume: Option<String>,

    /// Continue the most recent session. By default, forks the session with a new UUID.
    /// Use --no-fork to continue in the same session.
    #[arg(short = 'c', long = "continue")]
    pub continue_session: bool,

    /// When used with --resume or --continue, continue in the same session without forking to a new UUID.
    #[arg(long)]
    pub no_fork: bool,

    /// Generate session titles using AI (default: false). Disabling saves tokens and prevents rate limit issues.
    #[arg(long)]
    pub generate_title: bool,

    /// Maximum total retry time in seconds for rate limit errors (default: 604800 = 7 days)
    #[arg(long)]
    pub retry_timeout: Option<u64>,

    /// Retry AI completions API requests when rate limited (HTTP 429).
    /// Use --no-retry-on-rate-limits in integration tests to fail fast instead of waiting.
    #[arg(long)]
    retry_on_rate_limits: bool,
    #[arg(long = "no-retry-on-rate-limits", hide = true)]
    no_retry_on_rate_limits: bool,

    /// Include model info in step_finish output (default: true).
    /// Use --no-output-response-model to disable.
    #[arg(long)]
    output_response_model: bool,
    #[arg(long = "no-output-response-model", hide = true)]
    no_output_response_model: bool,

    /// Generate AI session summaries (default: true). Use --no-summarize-session to disable.
    #[arg(long)]
    summarize_session: bool,
    #[arg(long = "no-summarize-session", hide = true)]
    no_summarize_session: bool,

    /// Model to use for context compaction in format providerID/modelID.
    /// Use "same" to use the base model.
    #[arg(long, default_value_t = default_compaction_model())]
    pub compaction_model: String,

    /// Ordered cascade of compaction models in links notation sequence format.
    /// Models are tried from smallest/cheapest context to largest.
    /// The special value "same" uses the base model. Overrides --compaction-model when specified.
    #[arg(long, default_value_t = default_compaction_models())]
    pub compaction_models: String,

    /// Safety margin (%) of usable context window before triggering compaction.
    /// Only applies when the compaction model has equal or smaller context than the base model.
    #[arg(long, default_value_t = default_compaction_safety_margin_percent())]
    pub compaction_safety_margin: u32,

    /// Override the temperature for model completions.
    /// When not set, the default per-model temperature is used.
    #[arg(long)]
    pub temperature: Option<f64>,

    /// Working directory
    #[arg(long)]
    pub working_directory: Option<PathBuf>,
}

impl Args {
    /// Effective server mode: defaults to true, --no-server sets to false
    pub fn server(&self) -> bool {
        !self.no_server
    }

    /// Effective JSON output standard after applying --output-format aliases.
    pub fn effective_json_standard(&self) -> &str {
        match self.output_format.as_deref() {
            Some("stream-json") => "claude",
            Some("json") => "opencode",
            _ => self.json_standard.as_str(),
        }
    }

    /// Effective auto-merge: defaults to true, --no-auto-merge-queued-messages sets to false
    pub fn auto_merge_queued_messages(&self) -> bool {
        !self.no_auto_merge_queued_messages
    }

    /// Effective interactive: defaults to true, --no-interactive sets to false
    pub fn interactive(&self) -> bool {
        !self.no_interactive
    }

    /// Effective always-accept-stdin: defaults to true, --no-always-accept-stdin sets to false
    pub fn always_accept_stdin(&self) -> bool {
        !self.no_always_accept_stdin
    }

    /// Effective retry-on-rate-limits: defaults to true, --no-retry-on-rate-limits sets to false
    pub fn retry_on_rate_limits(&self) -> bool {
        !self.no_retry_on_rate_limits
    }

    /// Effective output-response-model: defaults to true, --no-output-response-model sets to false
    pub fn output_response_model(&self) -> bool {
        !self.no_output_response_model
    }

    /// Effective summarize-session: defaults to true, --no-summarize-session sets to false
    pub fn summarize_session(&self) -> bool {
        !self.no_summarize_session
    }
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

/// Read system message from file if specified
fn read_system_message_file(path: &str) -> Result<String> {
    std::fs::read_to_string(path).map_err(|e| AgentError::FileNotFound {
        path: path.to_string(),
        suggestions: vec![format!("Failed to read system message file: {}", e)],
    })
}

/// Resolve the effective system message from CLI args (mirrors JS readSystemMessages)
fn resolve_system_messages(args: &Args) -> Result<(Option<String>, Option<String>)> {
    // Full override: --system-message or --system-message-file
    let system_message = if let Some(ref msg) = args.system_message {
        Some(msg.clone())
    } else if let Some(ref path) = args.system_message_file {
        Some(read_system_message_file(path)?)
    } else {
        None
    };

    // Append: --append-system-message or --append-system-message-file
    let append_system_message = if let Some(ref msg) = args.append_system_message {
        Some(msg.clone())
    } else if let Some(ref path) = args.append_system_message_file {
        Some(read_system_message_file(path)?)
    } else {
        None
    };

    Ok((system_message, append_system_message))
}

/// Run the CLI with parsed arguments
pub async fn run(args: Args) -> Result<()> {
    let working_dir = args
        .working_directory
        .clone()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    // Resolve system messages from file args if needed
    let (system_message, append_system_message) = resolve_system_messages(&args)?;

    // Handle --disable-stdin: requires --prompt or shows help
    if args.disable_stdin && args.prompt.is_none() {
        return Err(AgentError::invalid_arguments(
            "cli",
            "--disable-stdin requires --prompt to be set",
        ));
    }

    // Handle direct prompt mode
    if let Some(ref prompt) = args.prompt {
        return run_with_input(
            &args,
            &working_dir,
            prompt,
            system_message.as_deref(),
            append_system_message.as_deref(),
        )
        .await;
    }

    // Output status
    let mode = if args.server() {
        "server"
    } else {
        "stdin-stream"
    };
    output_event(
        &OutputEvent::Status {
            mode: mode.to_string(),
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

                // Try to parse as JSON if not in interactive mode, otherwise treat as plain text
                let message = if args.interactive() {
                    match serde_json::from_str::<InputMessage>(trimmed) {
                        Ok(msg) => msg.message,
                        Err(_) => trimmed.to_string(),
                    }
                } else {
                    // Non-interactive mode: only accept JSON input
                    match serde_json::from_str::<InputMessage>(trimmed) {
                        Ok(msg) => msg.message,
                        Err(e) => {
                            output_event(
                                &OutputEvent::Error {
                                    timestamp: timestamp_ms(),
                                    session_id: None,
                                    error: serde_json::json!({
                                        "name": "InvalidInput",
                                        "data": { "message": format!("Expected JSON input in non-interactive mode: {}", e) }
                                    }),
                                },
                                args.compact_json,
                            );
                            continue;
                        }
                    }
                };

                if let Err(e) = run_with_input(
                    &args,
                    &working_dir,
                    &message,
                    system_message.as_deref(),
                    append_system_message.as_deref(),
                )
                .await
                {
                    output_event(
                        &OutputEvent::Error {
                            timestamp: timestamp_ms(),
                            session_id: None,
                            error: e.to_json(),
                        },
                        args.compact_json,
                    );
                }

                // In single-message mode (--no-always-accept-stdin), exit after first message
                if !args.always_accept_stdin() {
                    break;
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
async fn run_with_input(
    args: &Args,
    working_dir: &PathBuf,
    message: &str,
    system_message: Option<&str>,
    append_system_message: Option<&str>,
) -> Result<()> {
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

    // Log configuration when verbose mode is on
    if args.verbose {
        let temp_display = match args.temperature {
            Some(t) => format!("{}", t),
            None => "default".to_string(),
        };
        output_event(
            &OutputEvent::Text {
                timestamp: timestamp_ms(),
                session_id: session_id.clone(),
                text: format!("Temperature: {}", temp_display),
            },
            args.compact_json,
        );

        output_event(
            &OutputEvent::Text {
                timestamp: timestamp_ms(),
                session_id: session_id.clone(),
                text: format!("Model: {}", args.model),
            },
            args.compact_json,
        );

        output_event(
            &OutputEvent::Text {
                timestamp: timestamp_ms(),
                session_id: session_id.clone(),
                text: format!("JSON standard: {}", args.effective_json_standard()),
            },
            args.compact_json,
        );

        output_event(
            &OutputEvent::Text {
                timestamp: timestamp_ms(),
                session_id: session_id.clone(),
                text: format!("Compaction model: {}", args.compaction_model),
            },
            args.compact_json,
        );

        output_event(
            &OutputEvent::Text {
                timestamp: timestamp_ms(),
                session_id: session_id.clone(),
                text: format!("Compaction models: {}", args.compaction_models),
            },
            args.compact_json,
        );

        output_event(
            &OutputEvent::Text {
                timestamp: timestamp_ms(),
                session_id: session_id.clone(),
                text: format!(
                    "Compaction safety margin: {}%",
                    args.compaction_safety_margin
                ),
            },
            args.compact_json,
        );

        if let Some(sys_msg) = system_message {
            output_event(
                &OutputEvent::Text {
                    timestamp: timestamp_ms(),
                    session_id: session_id.clone(),
                    text: format!("System message: {}", sys_msg),
                },
                args.compact_json,
            );
        }

        if let Some(append_msg) = append_system_message {
            output_event(
                &OutputEvent::Text {
                    timestamp: timestamp_ms(),
                    session_id: session_id.clone(),
                    text: format!("Append system message: {}", append_msg),
                },
                args.compact_json,
            );
        }

        output_event(
            &OutputEvent::Text {
                timestamp: timestamp_ms(),
                session_id: session_id.clone(),
                text: format!("Server mode: {}", args.server()),
            },
            args.compact_json,
        );

        output_event(
            &OutputEvent::Text {
                timestamp: timestamp_ms(),
                session_id: session_id.clone(),
                text: format!("Interactive: {}", args.interactive()),
            },
            args.compact_json,
        );

        output_event(
            &OutputEvent::Text {
                timestamp: timestamp_ms(),
                session_id: session_id.clone(),
                text: format!("Generate title: {}", args.generate_title),
            },
            args.compact_json,
        );

        output_event(
            &OutputEvent::Text {
                timestamp: timestamp_ms(),
                session_id: session_id.clone(),
                text: format!("Summarize session: {}", args.summarize_session()),
            },
            args.compact_json,
        );

        output_event(
            &OutputEvent::Text {
                timestamp: timestamp_ms(),
                session_id: session_id.clone(),
                text: format!("Retry on rate limits: {}", args.retry_on_rate_limits()),
            },
            args.compact_json,
        );

        if let Some(timeout) = args.retry_timeout {
            output_event(
                &OutputEvent::Text {
                    timestamp: timestamp_ms(),
                    session_id: session_id.clone(),
                    text: format!("Retry timeout: {}s", timeout),
                },
                args.compact_json,
            );
        }
    }

    if args.dry_run {
        // In dry run mode, echo the message and show configuration
        let temp_info = match args.temperature {
            Some(t) => format!(", temperature: {}", t),
            None => String::new(),
        };
        output_event(
            &OutputEvent::Text {
                timestamp: timestamp_ms(),
                session_id: session_id.clone(),
                text: format!("[DRY RUN] Received message: {}{}", message, temp_info),
            },
            args.compact_json,
        );
    } else {
        // Create tool context
        let _ctx = ToolContext::new(&session_id, &message_id, working_dir);

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
