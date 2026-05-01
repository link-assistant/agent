//! Tests for CLI argument parsing and defaults.
//!
//! Extracted from the original inline tests in rust/src/cli.rs.

use clap::Parser;
use link_assistant_agent::cli::{
    Args, InputMessage, DEFAULT_COMPACTION_MODEL, DEFAULT_COMPACTION_MODELS,
    DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT, DEFAULT_MODEL,
};
use link_assistant_agent::defaults::{
    default_compaction_model_from_env, default_compaction_models_from_env,
    default_compaction_safety_margin_percent_from_env, default_model_from_env,
    default_model_parts_from_env, DEFAULT_COMPACTION_MODELS_ENV, DEFAULT_COMPACTION_MODEL_ENV,
    DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT_ENV, DEFAULT_MODEL_ENV,
};

#[test]
fn test_parse_json_input() {
    let input = r#"{"message": "hello world"}"#;
    let msg: InputMessage = serde_json::from_str(input).unwrap();
    assert_eq!(msg.message, "hello world");
}

#[test]
fn test_args_defaults() {
    let args = Args::parse_from(["agent"]);
    assert_eq!(args.model, DEFAULT_MODEL);
    assert_eq!(args.json_standard, "opencode");
    assert_eq!(args.input_format, "text");
    assert!(args.output_format.is_none());
    assert!(args.server());
    assert!(!args.verbose);
    assert!(!args.dry_run);
    assert!(!args.use_existing_claude_oauth);
    assert!(args.prompt.is_none());
    assert!(!args.disable_stdin);
    assert!(args.stdin_stream_timeout.is_none());
    assert!(args.auto_merge_queued_messages());
    assert!(args.interactive());
    assert!(args.always_accept_stdin());
    assert!(!args.compact_json);
    assert!(args.resume.is_none());
    assert!(!args.continue_session);
    assert!(!args.no_fork);
    assert!(!args.generate_title);
    assert!(args.retry_timeout.is_none());
    assert!(args.retry_on_rate_limits());
    assert!(args.output_response_model());
    assert!(args.summarize_session());
    assert_eq!(args.compaction_model, DEFAULT_COMPACTION_MODEL);
    assert_eq!(args.compaction_models, DEFAULT_COMPACTION_MODELS);
    assert_eq!(
        args.compaction_safety_margin,
        DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT
    );
    assert!(args.temperature.is_none());
    assert!(args.system_message.is_none());
    assert!(args.system_message_file.is_none());
    assert!(args.append_system_message.is_none());
    assert!(args.append_system_message_file.is_none());
    assert!(args.working_directory.is_none());
}

#[test]
fn test_args_with_prompt() {
    let args = Args::parse_from(["agent", "-p", "hello"]);
    assert_eq!(args.prompt, Some("hello".to_string()));
}

#[test]
fn test_args_temperature_not_set() {
    let args = Args::parse_from(["agent"]);
    assert!(args.temperature.is_none());
}

#[test]
fn test_args_temperature_float() {
    let args = Args::parse_from(["agent", "--temperature", "0.7"]);
    assert_eq!(args.temperature, Some(0.7));
}

#[test]
fn test_args_temperature_zero() {
    let args = Args::parse_from(["agent", "--temperature", "0"]);
    assert_eq!(args.temperature, Some(0.0));
}

#[test]
fn test_args_temperature_one() {
    let args = Args::parse_from(["agent", "--temperature", "1.0"]);
    assert_eq!(args.temperature, Some(1.0));
}

#[test]
fn test_args_temperature_with_prompt() {
    let args = Args::parse_from(["agent", "--temperature", "0.5", "-p", "hello"]);
    assert_eq!(args.temperature, Some(0.5));
    assert_eq!(args.prompt, Some("hello".to_string()));
}

#[test]
fn test_args_model() {
    let args = Args::parse_from(["agent", "--model", "opencode/gpt-5"]);
    assert_eq!(args.model, "opencode/gpt-5");
}

#[test]
fn test_args_json_standard_claude() {
    let args = Args::parse_from(["agent", "--json-standard", "claude"]);
    assert_eq!(args.json_standard, "claude");
}

#[test]
fn test_args_input_format_stream_json() {
    let args = Args::parse_from(["agent", "--input-format", "stream-json"]);
    assert_eq!(args.input_format, "stream-json");
}

#[test]
fn test_args_output_format_stream_json() {
    let args = Args::parse_from(["agent", "--output-format", "stream-json"]);
    assert_eq!(args.output_format, Some("stream-json".to_string()));
    assert_eq!(args.effective_json_standard(), "claude");
}

#[test]
fn test_args_output_format_json_maps_to_opencode() {
    let args = Args::parse_from([
        "agent",
        "--json-standard",
        "claude",
        "--output-format",
        "json",
    ]);
    assert_eq!(args.output_format, Some("json".to_string()));
    assert_eq!(args.effective_json_standard(), "opencode");
}

#[test]
fn test_args_system_message() {
    let args = Args::parse_from(["agent", "--system-message", "You are helpful"]);
    assert_eq!(args.system_message, Some("You are helpful".to_string()));
}

#[test]
fn test_args_system_message_file() {
    let args = Args::parse_from(["agent", "--system-message-file", "/tmp/sys.txt"]);
    assert_eq!(args.system_message_file, Some("/tmp/sys.txt".to_string()));
}

#[test]
fn test_args_append_system_message() {
    let args = Args::parse_from(["agent", "--append-system-message", "extra instructions"]);
    assert_eq!(
        args.append_system_message,
        Some("extra instructions".to_string())
    );
}

#[test]
fn test_args_append_system_message_file() {
    let args = Args::parse_from(["agent", "--append-system-message-file", "/tmp/append.txt"]);
    assert_eq!(
        args.append_system_message_file,
        Some("/tmp/append.txt".to_string())
    );
}

#[test]
fn test_args_server_mode() {
    let args = Args::parse_from(["agent"]);
    assert!(args.server());
}

#[test]
fn test_args_no_server() {
    let args = Args::parse_from(["agent", "--no-server"]);
    assert!(!args.server());
}

#[test]
fn test_args_verbose() {
    let args = Args::parse_from(["agent", "--verbose"]);
    assert!(args.verbose);
}

#[test]
fn test_args_dry_run() {
    let args = Args::parse_from(["agent", "--dry-run"]);
    assert!(args.dry_run);
}

#[test]
fn test_args_use_existing_claude_oauth() {
    let args = Args::parse_from(["agent", "--use-existing-claude-oauth"]);
    assert!(args.use_existing_claude_oauth);
}

#[test]
fn test_args_disable_stdin() {
    let args = Args::parse_from(["agent", "--disable-stdin", "-p", "test"]);
    assert!(args.disable_stdin);
}

#[test]
fn test_args_stdin_stream_timeout() {
    let args = Args::parse_from(["agent", "--stdin-stream-timeout", "5000"]);
    assert_eq!(args.stdin_stream_timeout, Some(5000));
}

#[test]
fn test_args_no_auto_merge_queued_messages() {
    let args = Args::parse_from(["agent", "--no-auto-merge-queued-messages"]);
    assert!(!args.auto_merge_queued_messages());
}

#[test]
fn test_args_no_interactive() {
    let args = Args::parse_from(["agent", "--no-interactive"]);
    assert!(!args.interactive());
}

#[test]
fn test_args_no_always_accept_stdin() {
    let args = Args::parse_from(["agent", "--no-always-accept-stdin"]);
    assert!(!args.always_accept_stdin());
}

#[test]
fn test_args_compact_json() {
    let args = Args::parse_from(["agent", "--compact-json"]);
    assert!(args.compact_json);
}

#[test]
fn test_args_resume() {
    let args = Args::parse_from(["agent", "--resume", "ses_abc123"]);
    assert_eq!(args.resume, Some("ses_abc123".to_string()));
}

#[test]
fn test_args_resume_short() {
    let args = Args::parse_from(["agent", "-r", "ses_abc123"]);
    assert_eq!(args.resume, Some("ses_abc123".to_string()));
}

#[test]
fn test_args_continue() {
    let args = Args::parse_from(["agent", "--continue"]);
    assert!(args.continue_session);
}

#[test]
fn test_args_continue_short() {
    let args = Args::parse_from(["agent", "-c"]);
    assert!(args.continue_session);
}

#[test]
fn test_args_no_fork() {
    let args = Args::parse_from(["agent", "--no-fork", "--resume", "ses_abc"]);
    assert!(args.no_fork);
}

#[test]
fn test_args_generate_title() {
    let args = Args::parse_from(["agent", "--generate-title"]);
    assert!(args.generate_title);
}

#[test]
fn test_args_retry_timeout() {
    let args = Args::parse_from(["agent", "--retry-timeout", "3600"]);
    assert_eq!(args.retry_timeout, Some(3600));
}

#[test]
fn test_args_no_retry_on_rate_limits() {
    let args = Args::parse_from(["agent", "--no-retry-on-rate-limits"]);
    assert!(!args.retry_on_rate_limits());
}

#[test]
fn test_args_no_output_response_model() {
    let args = Args::parse_from(["agent", "--no-output-response-model"]);
    assert!(!args.output_response_model());
}

#[test]
fn test_args_no_summarize_session() {
    let args = Args::parse_from(["agent", "--no-summarize-session"]);
    assert!(!args.summarize_session());
}

#[test]
fn test_args_compaction_model() {
    let args = Args::parse_from(["agent", "--compaction-model", "opencode/gpt-5"]);
    assert_eq!(args.compaction_model, "opencode/gpt-5");
}

#[test]
fn test_args_compaction_models() {
    let args = Args::parse_from(["agent", "--compaction-models", "(model1 model2 same)"]);
    assert_eq!(args.compaction_models, "(model1 model2 same)");
}

#[test]
fn test_args_compaction_safety_margin() {
    let args = Args::parse_from(["agent", "--compaction-safety-margin", "20"]);
    assert_eq!(args.compaction_safety_margin, 20);
}

#[test]
fn test_args_all_options_combined() {
    let args = Args::parse_from([
        "agent",
        "--model",
        "opencode/gpt-5",
        "--json-standard",
        "claude",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--system-message",
        "Be helpful",
        "--verbose",
        "--dry-run",
        "--compact-json",
        "--temperature",
        "0.8",
        "--compaction-model",
        "same",
        "--compaction-safety-margin",
        "10",
        "--no-interactive",
        "--no-always-accept-stdin",
        "--no-retry-on-rate-limits",
        "--retry-timeout",
        "60",
        "--generate-title",
        "--no-summarize-session",
        "-p",
        "test prompt",
    ]);
    assert_eq!(args.model, "opencode/gpt-5");
    assert_eq!(args.json_standard, "claude");
    assert_eq!(args.input_format, "stream-json");
    assert_eq!(args.output_format, Some("stream-json".to_string()));
    assert_eq!(args.effective_json_standard(), "claude");
    assert_eq!(args.system_message, Some("Be helpful".to_string()));
    assert!(args.verbose);
    assert!(args.dry_run);
    assert!(args.compact_json);
    assert_eq!(args.temperature, Some(0.8));
    assert_eq!(args.compaction_model, "same");
    assert_eq!(args.compaction_safety_margin, 10);
    assert!(!args.interactive());
    assert!(!args.always_accept_stdin());
    assert!(!args.retry_on_rate_limits());
    assert_eq!(args.retry_timeout, Some(60));
    assert!(args.generate_title);
    assert!(!args.summarize_session());
    assert_eq!(args.prompt, Some("test prompt".to_string()));
}

#[test]
fn test_default_model_matches_js() {
    assert_eq!(DEFAULT_MODEL, "opencode/minimax-m2.5-free");
}

#[test]
fn test_default_compaction_model_matches_js() {
    assert_eq!(DEFAULT_COMPACTION_MODEL, "opencode/gpt-5-nano");
}

#[test]
fn test_default_compaction_models_matches_js() {
    assert_eq!(
        DEFAULT_COMPACTION_MODELS,
        "(big-pickle minimax-m2.5-free nemotron-3-super-free hy3-preview-free ling-2.6-flash-free gpt-5-nano same)"
    );
}

#[test]
fn test_default_compaction_safety_margin_matches_js() {
    assert_eq!(DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT, 25);
}

#[test]
fn test_default_model_can_be_overridden_by_env_reader() {
    let model = default_model_from_env(|key| {
        (key == DEFAULT_MODEL_ENV).then(|| "opencode/env-default-free".to_string())
    });
    assert_eq!(model, "opencode/env-default-free");
}

#[test]
fn test_default_model_parts_are_importable_from_library() {
    let parts = default_model_parts_from_env(|key| {
        (key == DEFAULT_MODEL_ENV).then(|| "opencode/env-default-free".to_string())
    });
    assert_eq!(parts.provider_id, "opencode");
    assert_eq!(parts.model_id, "env-default-free");
}

#[test]
fn test_default_compaction_values_can_be_overridden_by_env_reader() {
    let compaction_model = default_compaction_model_from_env(|key| {
        (key == DEFAULT_COMPACTION_MODEL_ENV).then(|| "opencode/env-compact-free".to_string())
    });
    let compaction_models = default_compaction_models_from_env(|key| {
        (key == DEFAULT_COMPACTION_MODELS_ENV).then(|| "(env-compact-free same)".to_string())
    });
    let compaction_safety_margin = default_compaction_safety_margin_percent_from_env(|key| {
        (key == DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT_ENV).then(|| "12".to_string())
    });

    assert_eq!(compaction_model, "opencode/env-compact-free");
    assert_eq!(compaction_models, "(env-compact-free same)");
    assert_eq!(compaction_safety_margin, 12);
}
