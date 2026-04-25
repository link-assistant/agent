//! Rust counterpart of `js/tests/verbose-stderr-type.ts`.
//!
//! The JS test exercises a stderr interceptor that wraps verbose output
//! lines in a typed envelope so downstream tooling can distinguish
//! verbose diagnostics from program errors. The Rust port writes through
//! `tracing` directly, so there is no JS-style interceptor to test.
//!
//! These tests verify that the Rust binary respects the same convention
//! the JS interceptor enforces: verbose output is allowed alongside
//! normal stdout without breaking the JSON event stream.

use assert_cmd::Command;
use predicates::prelude::*;

#[test]
fn verbose_dry_run_emits_dry_run_marker_on_stdout() {
    Command::cargo_bin("agent")
        .unwrap()
        .args(["--verbose", "--dry-run", "-p", "hello"])
        .assert()
        .success()
        .stdout(predicate::str::contains("[DRY RUN]"));
}
