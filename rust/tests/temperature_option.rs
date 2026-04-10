//! Integration tests for the --temperature CLI option.
//!
//! Issue #241: Add --temperature option that overrides the per-model and
//! per-agent temperature defaults. When not set, existing behavior must
//! remain unchanged.
//!
//! These tests verify the Rust CLI binary accepts and parses the
//! --temperature flag correctly, mirroring the JavaScript test suite.

use assert_cmd::cargo_bin_cmd;
use predicates::prelude::*;

/// Helper to create a Command for the agent binary.
fn agent_cmd() -> assert_cmd::Command {
    cargo_bin_cmd!()
}

#[test]
fn temperature_option_not_required() {
    // When --temperature is not provided, the agent should start normally.
    // Use --dry-run and --prompt to get a quick deterministic response.
    agent_cmd()
        .args(["--dry-run", "-p", "hello"])
        .assert()
        .success()
        .stdout(predicate::str::contains("[DRY RUN]"));
}

#[test]
fn temperature_option_accepts_float_value() {
    // When --temperature is provided with a valid float, the agent should
    // accept it without error.
    agent_cmd()
        .args(["--dry-run", "--temperature", "0.7", "-p", "hello"])
        .assert()
        .success()
        .stdout(predicate::str::contains("[DRY RUN]"));
}

#[test]
fn temperature_option_accepts_zero() {
    // Temperature 0 should be accepted (deterministic output use case).
    agent_cmd()
        .args(["--dry-run", "--temperature", "0", "-p", "hello"])
        .assert()
        .success()
        .stdout(predicate::str::contains("[DRY RUN]"));
}

#[test]
fn temperature_option_accepts_one() {
    // Temperature 1.0 should be accepted.
    agent_cmd()
        .args(["--dry-run", "--temperature", "1.0", "-p", "hello"])
        .assert()
        .success()
        .stdout(predicate::str::contains("[DRY RUN]"));
}

#[test]
fn temperature_option_rejects_non_numeric() {
    // --temperature with a non-numeric value should fail with an error.
    agent_cmd()
        .args(["--dry-run", "--temperature", "hot", "-p", "hello"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("invalid value"));
}
