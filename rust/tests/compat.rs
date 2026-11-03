//! Tests for the tool compatibility switches (`src/compat.rs`) and their CLI
//! flags. Nothing here changes the test process environment: settings are
//! built from a lookup closure, and CLI runs get their own environment.

use assert_cmd::Command;
use clap::Parser;
use link_assistant_agent::cli::Args;
use link_assistant_agent::compat::*;
use link_assistant_agent::tool::batch::BatchTool;
use link_assistant_agent::tool::{Tool, ToolContext, ToolRegistry};
use predicates::prelude::*;
use serde_json::json;
use std::collections::HashMap;

fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
    let map: HashMap<String, String> = pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    move |name: &str| map.get(name).cloned()
}

#[test]
fn parse_bool_matches_js_truthy_env() {
    assert!(parse_bool(Some("true"), false));
    assert!(parse_bool(Some("TRUE"), false));
    assert!(parse_bool(Some("1"), false));
    assert!(!parse_bool(Some("false"), true));
    assert!(!parse_bool(Some("0"), true));
    // Anything else keeps the default.
    assert!(parse_bool(Some("yes"), true));
    assert!(!parse_bool(Some("yes"), false));
    assert!(parse_bool(Some(""), true));
    assert!(!parse_bool(None, false));
}

#[test]
fn defaults_without_environment() {
    let s = ToolSettings::from_getenv(env(&[]));
    assert_eq!(s, ToolSettings::default());
    assert_eq!(s.bash_shell, "auto");
    assert!(!s.legacy_tool_output);
    assert!(!s.legacy_edit_matching);
    assert!(!s.glob_follow_symlinks);
    assert!(s.grep_hidden);
    assert_eq!(s.grep_timeout_ms, 30_000);
    assert_eq!(s.read_max_lines, 2000);
    assert_eq!(s.read_max_bytes, 51_200);
    assert!(!s.read_only);
    assert!(s.disable_tools.is_empty());
    assert!(s.denied_tools().is_empty());
}

#[test]
fn every_switch_is_read_from_its_variable() {
    let s = ToolSettings::from_getenv(env(&[
        (BASH_SHELL_ENV, "legacy"),
        (LEGACY_TOOL_OUTPUT_ENV, "true"),
        (LEGACY_EDIT_MATCHING_ENV, "1"),
        (GLOB_FOLLOW_SYMLINKS_ENV, "true"),
        (GREP_HIDDEN_ENV, "false"),
        (GREP_TIMEOUT_MS_ENV, "0"),
        (READ_MAX_LINES_ENV, "0"),
        (READ_MAX_BYTES_ENV, "100"),
        (READ_ONLY_ENV, "1"),
        (DISABLE_TOOLS_ENV, " WebFetch , ,codesearch"),
    ]));
    assert_eq!(s.bash_shell, "legacy");
    assert!(s.legacy_tool_output);
    assert!(s.legacy_edit_matching);
    assert!(s.glob_follow_symlinks);
    assert!(!s.grep_hidden);
    assert_eq!(s.grep_timeout_ms, 0);
    assert_eq!(s.read_max_lines, 0);
    assert_eq!(s.read_max_bytes, 100);
    assert!(s.read_only);
    assert_eq!(s.disable_tools, vec!["webfetch", "codesearch"]);
}

#[test]
fn invalid_numbers_fall_back_to_defaults() {
    let s = ToolSettings::from_getenv(env(&[
        (GREP_TIMEOUT_MS_ENV, "soon"),
        (READ_MAX_LINES_ENV, "-5"),
        (READ_MAX_BYTES_ENV, ""),
        (BASH_SHELL_ENV, "  "),
    ]));
    assert_eq!(s.grep_timeout_ms, DEFAULT_GREP_TIMEOUT_MS);
    assert_eq!(s.read_max_lines, DEFAULT_READ_MAX_LINES);
    assert_eq!(s.read_max_bytes, DEFAULT_READ_MAX_BYTES);
    assert_eq!(s.bash_shell, "auto");
}

#[test]
fn legacy_preset_restores_previous_release() {
    let s = ToolSettings::legacy();
    assert_eq!(s.bash_shell, "legacy");
    assert!(s.legacy_tool_output && s.legacy_edit_matching);
    assert!(!s.grep_hidden);
    assert_eq!(
        (s.grep_timeout_ms, s.read_max_lines, s.read_max_bytes),
        (0, 0, 0)
    );
}

#[test]
fn read_only_denies_the_js_set() {
    let s = ToolSettings {
        read_only: true,
        ..ToolSettings::default()
    };
    let denied: Vec<String> = s.denied_tools().into_iter().collect();
    assert_eq!(denied, vec!["bash", "edit", "multiedit", "patch", "write"]);
    assert!(s.is_denied("bash"));
    assert!(s.is_denied("Bash"));
    assert!(!s.is_denied("read"));
}

#[test]
fn registry_filter_drops_denied_tools() {
    let all = ToolRegistry::new();
    let same = ToolRegistry::with_settings(&ToolSettings::default());
    assert_eq!(all.all().len(), same.all().len());

    let read_only = ToolRegistry::with_settings(&ToolSettings {
        read_only: true,
        disable_tools: vec!["webfetch".to_string()],
        ..ToolSettings::default()
    });
    for id in ["bash", "edit", "write", "multiedit", "webfetch"] {
        assert!(read_only.get(id).is_none(), "{} should be disabled", id);
    }
    for id in ["read", "glob", "grep", "list", "batch"] {
        assert!(read_only.get(id).is_some(), "{} should stay", id);
    }
}

#[tokio::test]
async fn batch_rejects_denied_tools() {
    let temp = tempfile::TempDir::new().unwrap();
    std::fs::write(temp.path().join("a.txt"), "x").unwrap();
    let ctx = ToolContext::new("ses_compat", "msg", temp.path()).with_settings(ToolSettings {
        read_only: true,
        ..ToolSettings::default()
    });
    let result = BatchTool
        .execute(
            json!({"tool_calls": [
                {"tool": "bash", "parameters": {"command": "touch should-not-exist"}},
                {"tool": "read", "parameters": {"filePath": "a.txt"}}
            ]}),
            &ctx,
        )
        .await
        .unwrap();
    assert!(!temp.path().join("should-not-exist").exists());
    assert_eq!(result.metadata["failed"], 1);
    assert_eq!(result.metadata["successful"], 1);

    // Without read-only mode the same call runs.
    let ctx =
        ToolContext::new("ses_compat", "msg", temp.path()).with_settings(ToolSettings::default());
    let result = BatchTool
        .execute(
            json!({"tool_calls": [
                {"tool": "bash", "parameters": {"command": "touch made"}}
            ]}),
            &ctx,
        )
        .await
        .unwrap();
    assert_eq!(result.metadata["successful"], 1);
    assert!(temp.path().join("made").exists());
}

#[test]
fn denied_message_matches_js() {
    assert_eq!(
        denied_message("bash"),
        "Tool 'bash' is disabled in read-only / planning mode and cannot be executed."
    );
}

#[test]
fn flags_map_to_environment_variables() {
    let args = Args::parse_from([
        "agent",
        "--bash-shell",
        "legacy",
        "--legacy-tool-output",
        "--legacy-edit-matching=false",
        "--glob-follow-symlinks",
        "--grep-hidden=false",
        "--grep-timeout-ms",
        "0",
        "--read-max-lines",
        "0",
        "--read-max-bytes",
        "0",
        "--read-only",
        "--disable-tools",
        "webfetch",
    ]);
    let got: HashMap<&str, String> = args.tool_settings_env_overrides().into_iter().collect();
    assert_eq!(got[BASH_SHELL_ENV], "legacy");
    assert_eq!(got[LEGACY_TOOL_OUTPUT_ENV], "true");
    assert_eq!(got[LEGACY_EDIT_MATCHING_ENV], "false");
    assert_eq!(got[GLOB_FOLLOW_SYMLINKS_ENV], "true");
    assert_eq!(got[GREP_HIDDEN_ENV], "false");
    assert_eq!(got[GREP_TIMEOUT_MS_ENV], "0");
    assert_eq!(got[READ_MAX_LINES_ENV], "0");
    assert_eq!(got[READ_MAX_BYTES_ENV], "0");
    assert_eq!(got[READ_ONLY_ENV], "true");
    assert_eq!(got[DISABLE_TOOLS_ENV], "webfetch");
    // The values parse back to the intended settings.
    let s = ToolSettings::from_getenv(|name| got.get(name).cloned());
    assert!(s.legacy_tool_output && !s.legacy_edit_matching && !s.grep_hidden && s.read_only);
}

#[test]
fn no_flags_means_no_overrides() {
    let args = Args::parse_from(["agent"]);
    assert!(args.tool_settings_env_overrides().is_empty());
}

#[test]
fn bool_flag_does_not_swallow_the_next_argument() {
    let args = Args::parse_from(["agent", "--read-only", "-p", "hi"]);
    assert_eq!(args.read_only, Some(true));
    assert_eq!(args.prompt.as_deref(), Some("hi"));
}

fn agent() -> Command {
    let mut cmd = Command::cargo_bin("agent").unwrap();
    for name in ALL_ENV {
        cmd.env_remove(name);
    }
    cmd
}

#[test]
fn cli_lists_all_tools_by_default() {
    agent()
        .args(["-p", "hi"])
        .assert()
        .success()
        .stdout(predicate::str::contains("invalid, bash, read"));
}

#[test]
fn cli_read_only_flag_hides_mutating_tools() {
    agent()
        .args(["--read-only", "-p", "hi"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Available tools: invalid, read"))
        .stdout(predicate::str::contains(" edit,").not());
}

#[test]
fn cli_read_only_env_hides_mutating_tools() {
    agent()
        .env(READ_ONLY_ENV, "1")
        .env(DISABLE_TOOLS_ENV, "WebFetch")
        .args(["-p", "hi"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Available tools: invalid, read"))
        .stdout(predicate::str::contains("webfetch").not());
}

#[test]
fn cli_verbose_prints_effective_settings() {
    agent()
        .args(["--verbose", "--legacy-tool-output", "-p", "hi"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Legacy tool output: true"))
        .stdout(predicate::str::contains("Grep timeout: 30000ms"));
}
