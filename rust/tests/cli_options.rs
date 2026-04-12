//! Integration tests for all CLI options.
//!
//! Verifies that the Rust CLI binary supports the same set of CLI options
//! as the JavaScript implementation, ensuring full feature parity.
//! Each option is tested via the compiled binary using assert_cmd.

use assert_cmd::Command;
use predicates::prelude::*;
use std::io::Write;

/// Helper to create a Command for the agent binary.
fn agent_cmd() -> assert_cmd::Command {
    Command::cargo_bin("agent").unwrap()
}

// ── Model option ──────────────────────────────────────────────────────

#[test]
fn model_option_default() {
    // Default model should be opencode/nemotron-3-super-free (matching JS).
    agent_cmd()
        .args(["--dry-run", "--verbose", "-p", "hello"])
        .assert()
        .success()
        .stdout(predicate::str::contains(
            "Model: opencode/nemotron-3-super-free",
        ));
}

#[test]
fn model_option_custom() {
    agent_cmd()
        .args([
            "--dry-run",
            "--verbose",
            "--model",
            "opencode/gpt-5",
            "-p",
            "hello",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Model: opencode/gpt-5"));
}

// ── JSON standard option ─────────────────────────────────────────────

#[test]
fn json_standard_default() {
    agent_cmd()
        .args(["--dry-run", "--verbose", "-p", "hello"])
        .assert()
        .success()
        .stdout(predicate::str::contains("JSON standard: opencode"));
}

#[test]
fn json_standard_claude() {
    agent_cmd()
        .args([
            "--dry-run",
            "--verbose",
            "--json-standard",
            "claude",
            "-p",
            "hello",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("JSON standard: claude"));
}

#[test]
fn json_standard_rejects_invalid() {
    agent_cmd()
        .args(["--dry-run", "--json-standard", "xml", "-p", "hello"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("invalid value"));
}

// ── System message options ───────────────────────────────────────────

#[test]
fn system_message_option() {
    agent_cmd()
        .args([
            "--dry-run",
            "--verbose",
            "--system-message",
            "You are a test bot",
            "-p",
            "hello",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains(
            "System message: You are a test bot",
        ));
}

#[test]
fn system_message_file_option() {
    // Create a temp file with system message content
    let mut tmpfile = tempfile::NamedTempFile::new().unwrap();
    write!(tmpfile, "System from file").unwrap();
    let path = tmpfile.path().to_str().unwrap().to_string();

    agent_cmd()
        .args([
            "--dry-run",
            "--verbose",
            "--system-message-file",
            &path,
            "-p",
            "hello",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("System message: System from file"));
}

#[test]
fn append_system_message_option() {
    agent_cmd()
        .args([
            "--dry-run",
            "--verbose",
            "--append-system-message",
            "Extra instructions",
            "-p",
            "hello",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains(
            "Append system message: Extra instructions",
        ));
}

#[test]
fn append_system_message_file_option() {
    let mut tmpfile = tempfile::NamedTempFile::new().unwrap();
    write!(tmpfile, "Appended from file").unwrap();
    let path = tmpfile.path().to_str().unwrap().to_string();

    agent_cmd()
        .args([
            "--dry-run",
            "--verbose",
            "--append-system-message-file",
            &path,
            "-p",
            "hello",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains(
            "Append system message: Appended from file",
        ));
}

#[test]
fn system_message_file_not_found() {
    agent_cmd()
        .args([
            "--dry-run",
            "--system-message-file",
            "/tmp/nonexistent_file_12345.txt",
            "-p",
            "hello",
        ])
        .assert()
        .failure();
}

// ── Server mode option ───────────────────────────────────────────────

#[test]
fn server_mode_default_true() {
    agent_cmd()
        .args(["--dry-run", "--verbose", "-p", "hello"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Server mode: true"));
}

#[test]
fn server_mode_disabled() {
    agent_cmd()
        .args(["--dry-run", "--verbose", "--no-server", "-p", "hello"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Server mode: false"));
}

// ── Verbose option ───────────────────────────────────────────────────

#[test]
fn verbose_shows_config() {
    // When verbose is on, many config values should be displayed.
    agent_cmd()
        .args(["--dry-run", "--verbose", "-p", "hello"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Model:"))
        .stdout(predicate::str::contains("JSON standard:"))
        .stdout(predicate::str::contains("Compaction model:"))
        .stdout(predicate::str::contains("Compaction models:"))
        .stdout(predicate::str::contains("Compaction safety margin:"))
        .stdout(predicate::str::contains("Interactive:"))
        .stdout(predicate::str::contains("Generate title:"))
        .stdout(predicate::str::contains("Summarize session:"))
        .stdout(predicate::str::contains("Retry on rate limits:"));
}

#[test]
fn verbose_off_hides_config() {
    // Without verbose, config lines should NOT appear.
    agent_cmd()
        .args(["--dry-run", "-p", "hello"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Model:").not())
        .stdout(predicate::str::contains("JSON standard:").not());
}

// ── Dry run option ───────────────────────────────────────────────────

#[test]
fn dry_run_echoes_message() {
    agent_cmd()
        .args(["--dry-run", "-p", "test message"])
        .assert()
        .success()
        .stdout(predicate::str::contains(
            "[DRY RUN] Received message: test message",
        ));
}

// ── Use existing Claude OAuth option ─────────────────────────────────

#[test]
fn use_existing_claude_oauth_accepted() {
    agent_cmd()
        .args(["--dry-run", "--use-existing-claude-oauth", "-p", "hello"])
        .assert()
        .success();
}

// ── Prompt option ────────────────────────────────────────────────────

#[test]
fn prompt_short_flag() {
    agent_cmd()
        .args(["--dry-run", "-p", "short flag test"])
        .assert()
        .success()
        .stdout(predicate::str::contains("short flag test"));
}

#[test]
fn prompt_long_flag() {
    agent_cmd()
        .args(["--dry-run", "--prompt", "long flag test"])
        .assert()
        .success()
        .stdout(predicate::str::contains("long flag test"));
}

// ── Disable stdin option ─────────────────────────────────────────────

#[test]
fn disable_stdin_with_prompt_succeeds() {
    agent_cmd()
        .args(["--dry-run", "--disable-stdin", "-p", "hello"])
        .assert()
        .success();
}

#[test]
fn disable_stdin_without_prompt_fails() {
    agent_cmd()
        .args(["--dry-run", "--disable-stdin"])
        .assert()
        .failure();
}

// ── Stdin stream timeout option ──────────────────────────────────────

#[test]
fn stdin_stream_timeout_accepted() {
    agent_cmd()
        .args(["--dry-run", "--stdin-stream-timeout", "5000", "-p", "hello"])
        .assert()
        .success();
}

// ── Auto merge queued messages option ────────────────────────────────

#[test]
fn auto_merge_queued_messages_default() {
    agent_cmd()
        .args(["--dry-run", "-p", "hello"])
        .assert()
        .success();
}

#[test]
fn no_auto_merge_queued_messages() {
    agent_cmd()
        .args([
            "--dry-run",
            "--no-auto-merge-queued-messages",
            "-p",
            "hello",
        ])
        .assert()
        .success();
}

// ── Interactive option ───────────────────────────────────────────────

#[test]
fn interactive_default_true() {
    agent_cmd()
        .args(["--dry-run", "--verbose", "-p", "hello"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Interactive: true"));
}

#[test]
fn no_interactive() {
    agent_cmd()
        .args(["--dry-run", "--verbose", "--no-interactive", "-p", "hello"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Interactive: false"));
}

// ── Always accept stdin option ───────────────────────────────────────

#[test]
fn no_always_accept_stdin() {
    agent_cmd()
        .args(["--dry-run", "--no-always-accept-stdin", "-p", "hello"])
        .assert()
        .success();
}

// ── Compact JSON option ──────────────────────────────────────────────

#[test]
fn compact_json_single_line() {
    let output = agent_cmd()
        .args(["--dry-run", "--compact-json", "-p", "hello"])
        .output()
        .unwrap();
    let stdout = String::from_utf8(output.stdout).unwrap();
    // In compact mode, each JSON event should be on a single line
    for line in stdout.lines() {
        if line.trim().is_empty() {
            continue;
        }
        // Each non-empty line should be valid JSON
        assert!(
            serde_json::from_str::<serde_json::Value>(line).is_ok(),
            "Expected valid JSON on single line, got: {}",
            line
        );
    }
}

// ── Resume option ────────────────────────────────────────────────────

#[test]
fn resume_option_accepted() {
    agent_cmd()
        .args(["--dry-run", "--resume", "ses_abc123", "-p", "hello"])
        .assert()
        .success();
}

#[test]
fn resume_short_flag() {
    agent_cmd()
        .args(["--dry-run", "-r", "ses_abc123", "-p", "hello"])
        .assert()
        .success();
}

// ── Continue option ──────────────────────────────────────────────────

#[test]
fn continue_option_accepted() {
    agent_cmd()
        .args(["--dry-run", "--continue", "-p", "hello"])
        .assert()
        .success();
}

#[test]
fn continue_short_flag() {
    agent_cmd()
        .args(["--dry-run", "-c", "-p", "hello"])
        .assert()
        .success();
}

// ── No fork option ───────────────────────────────────────────────────

#[test]
fn no_fork_option_accepted() {
    agent_cmd()
        .args([
            "--dry-run",
            "--no-fork",
            "--resume",
            "ses_abc",
            "-p",
            "hello",
        ])
        .assert()
        .success();
}

// ── Generate title option ────────────────────────────────────────────

#[test]
fn generate_title_option() {
    agent_cmd()
        .args(["--dry-run", "--verbose", "--generate-title", "-p", "hello"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Generate title: true"));
}

// ── Retry timeout option ─────────────────────────────────────────────

#[test]
fn retry_timeout_option() {
    agent_cmd()
        .args([
            "--dry-run",
            "--verbose",
            "--retry-timeout",
            "3600",
            "-p",
            "hello",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Retry timeout: 3600s"));
}

// ── Retry on rate limits option ──────────────────────────────────────

#[test]
fn retry_on_rate_limits_default_true() {
    agent_cmd()
        .args(["--dry-run", "--verbose", "-p", "hello"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Retry on rate limits: true"));
}

#[test]
fn no_retry_on_rate_limits() {
    agent_cmd()
        .args([
            "--dry-run",
            "--verbose",
            "--no-retry-on-rate-limits",
            "-p",
            "hello",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Retry on rate limits: false"));
}

// ── Output response model option ─────────────────────────────────────

#[test]
fn output_response_model_accepted() {
    agent_cmd()
        .args(["--dry-run", "--no-output-response-model", "-p", "hello"])
        .assert()
        .success();
}

// ── Summarize session option ─────────────────────────────────────────

#[test]
fn summarize_session_default() {
    agent_cmd()
        .args(["--dry-run", "--verbose", "-p", "hello"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Summarize session: true"));
}

#[test]
fn no_summarize_session() {
    agent_cmd()
        .args([
            "--dry-run",
            "--verbose",
            "--no-summarize-session",
            "-p",
            "hello",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Summarize session: false"));
}

// ── Compaction model option ──────────────────────────────────────────

#[test]
fn compaction_model_default() {
    agent_cmd()
        .args(["--dry-run", "--verbose", "-p", "hello"])
        .assert()
        .success()
        .stdout(predicate::str::contains(
            "Compaction model: opencode/gpt-5-nano",
        ));
}

#[test]
fn compaction_model_custom() {
    agent_cmd()
        .args([
            "--dry-run",
            "--verbose",
            "--compaction-model",
            "same",
            "-p",
            "hello",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Compaction model: same"));
}

// ── Compaction models option ─────────────────────────────────────────

#[test]
fn compaction_models_default() {
    agent_cmd()
        .args(["--dry-run", "--verbose", "-p", "hello"])
        .assert()
        .success()
        .stdout(predicate::str::contains(
            "Compaction models: (big-pickle minimax-m2.5-free nemotron-3-super-free gpt-5-nano same)",
        ));
}

#[test]
fn compaction_models_custom() {
    agent_cmd()
        .args([
            "--dry-run",
            "--verbose",
            "--compaction-models",
            "(model1 same)",
            "-p",
            "hello",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Compaction models: (model1 same)"));
}

// ── Compaction safety margin option ──────────────────────────────────

#[test]
fn compaction_safety_margin_default() {
    agent_cmd()
        .args(["--dry-run", "--verbose", "-p", "hello"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Compaction safety margin: 25%"));
}

#[test]
fn compaction_safety_margin_custom() {
    agent_cmd()
        .args([
            "--dry-run",
            "--verbose",
            "--compaction-safety-margin",
            "25",
            "-p",
            "hello",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Compaction safety margin: 25%"));
}

// ── All options combined ─────────────────────────────────────────────

#[test]
fn all_options_accepted_together() {
    // Verify that the binary accepts all options simultaneously without conflict.
    agent_cmd()
        .args([
            "--model",
            "opencode/gpt-5",
            "--json-standard",
            "claude",
            "--system-message",
            "Be helpful",
            "--verbose",
            "--dry-run",
            "--use-existing-claude-oauth",
            "--compact-json",
            "--no-interactive",
            "--no-always-accept-stdin",
            "--no-auto-merge-queued-messages",
            "--generate-title",
            "--no-retry-on-rate-limits",
            "--retry-timeout",
            "60",
            "--no-output-response-model",
            "--no-summarize-session",
            "--compaction-model",
            "same",
            "--compaction-models",
            "(same)",
            "--compaction-safety-margin",
            "20",
            "--temperature",
            "0.5",
            "--no-server",
            "--no-fork",
            "--resume",
            "ses_abc",
            "--stdin-stream-timeout",
            "1000",
            "--disable-stdin",
            "-p",
            "test",
        ])
        .assert()
        .success();
}
