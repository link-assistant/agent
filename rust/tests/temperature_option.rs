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
    // accept it without error and include the temperature in dry-run output.
    agent_cmd()
        .args(["--dry-run", "--temperature", "0.7", "-p", "hello"])
        .assert()
        .success()
        .stdout(predicate::str::contains("[DRY RUN]"))
        .stdout(predicate::str::contains("temperature: 0.7"));
}

#[test]
fn temperature_option_accepts_zero() {
    // Temperature 0 should be accepted (deterministic output use case).
    agent_cmd()
        .args(["--dry-run", "--temperature", "0", "-p", "hello"])
        .assert()
        .success()
        .stdout(predicate::str::contains("[DRY RUN]"))
        .stdout(predicate::str::contains("temperature: 0"));
}

#[test]
fn temperature_option_accepts_one() {
    // Temperature 1.0 should be accepted.
    agent_cmd()
        .args(["--dry-run", "--temperature", "1.0", "-p", "hello"])
        .assert()
        .success()
        .stdout(predicate::str::contains("[DRY RUN]"))
        .stdout(predicate::str::contains("temperature: 1"));
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

#[test]
fn temperature_option_not_shown_when_unset() {
    // When --temperature is not provided, it should NOT appear in the output.
    // This ensures the existing behavior is unchanged.
    agent_cmd()
        .args(["--dry-run", "-p", "hello"])
        .assert()
        .success()
        .stdout(predicate::str::contains("temperature:").not());
}

#[test]
fn temperature_option_verbose_logging() {
    // When --verbose is enabled and temperature is set, it should appear in verbose output.
    agent_cmd()
        .args([
            "--dry-run",
            "--verbose",
            "--temperature",
            "0.42",
            "-p",
            "hello",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Temperature: 0.42"));
}

#[test]
fn temperature_option_verbose_default_when_unset() {
    // When --verbose is enabled but temperature is NOT set, verbose output shows "default".
    agent_cmd()
        .args(["--dry-run", "--verbose", "-p", "hello"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Temperature: default"));
}
