//! Rust counterpart of `js/tests/verbose-http-logging.ts`.
//!
//! The JS test exercises detailed HTTP request/response logging when
//! `--verbose` is enabled (header sanitization, body preview truncation,
//! rate-limit handling, etc.). The Rust port does not yet ship the
//! corresponding HTTP middleware. When it does, this file should mirror
//! the JS test cases byte-for-byte.
//!
//! For now we verify the related CLI surface: `--verbose` is recognized
//! by the binary and the `agent --version` command starts cleanly.

use assert_cmd::Command;
use predicates::prelude::*;

#[test]
fn agent_version_runs_with_verbose_flag() {
    Command::cargo_bin("agent")
        .unwrap()
        .args(["--verbose", "--version"])
        .assert()
        .success()
        .stdout(predicate::str::contains("agent"));
}

#[test]
fn agent_help_runs_with_verbose_flag() {
    Command::cargo_bin("agent")
        .unwrap()
        .args(["--verbose", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("agent"));
}
