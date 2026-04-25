//! Rust counterpart of `js/tests/integration/basic.js`.
//!
//! The JS test sends a "hi" message to the running agent and asserts a
//! step_start / step_finish event sequence is emitted. The Rust port has
//! the same CLI surface (`-p` / `--prompt`, `--dry-run`) but the live
//! provider integration is JS-only at the moment.
//!
//! These tests exercise the Rust binary at the same surface the JS test
//! relies on (CLI parsing, stdout shape) without requiring a live API key.

use assert_cmd::Command;
use predicates::prelude::*;

#[test]
fn dry_run_with_prompt_emits_dry_run_marker() {
    Command::cargo_bin("agent")
        .unwrap()
        .args(["--dry-run", "-p", "hi"])
        .assert()
        .success()
        .stdout(predicate::str::contains("[DRY RUN]"));
}

#[test]
fn dry_run_completes_without_provider_credentials() {
    // The JS suite uses a free-tier model for the live test. The Rust
    // dry-run path should succeed regardless of provider auth state.
    Command::cargo_bin("agent")
        .unwrap()
        .args(["--dry-run", "-p", "hi"])
        .env_remove("OPENROUTER_API_KEY")
        .env_remove("GROQ_API_KEY")
        .env_remove("ANTHROPIC_API_KEY")
        .assert()
        .success();
}
