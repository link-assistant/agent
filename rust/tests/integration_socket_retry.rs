//! Rust counterpart of `js/tests/integration/socket-retry.js`.
//!
//! The JS suite covers the socket retry integration path against the
//! live agent runtime. The Rust port shares the same CLI surface but the
//! live runtime integrations land incrementally; this file pins the base
//! name so the JS and Rust test trees stay aligned.

use assert_cmd::Command;
use predicates::prelude::*;

#[test]
fn dry_run_completes_without_credentials() {
    Command::cargo_bin("agent")
        .unwrap()
        .args(["--dry-run", "-p", "hello"])
        .env_remove("OPENROUTER_API_KEY")
        .env_remove("GROQ_API_KEY")
        .env_remove("ANTHROPIC_API_KEY")
        .assert()
        .success()
        .stdout(predicate::str::contains("[DRY RUN]"));
}

#[test]
fn agent_help_runs_cleanly() {
    Command::cargo_bin("agent")
        .unwrap()
        .arg("--help")
        .assert()
        .success();
}
