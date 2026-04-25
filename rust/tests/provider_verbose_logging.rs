//! Rust counterpart of `js/tests/provider-verbose-logging.ts`.
//!
//! The JS test asserts that verbose provider logging is suppressed in
//! specific scenarios (e.g. dry-run, programmatic invocations). The Rust
//! port does not yet ship the AI-SDK provider wrappers, so the JS-only
//! suppression paths cannot be exercised directly.
//!
//! These tests verify the surface that *is* observable in Rust today: the
//! `--verbose` flag toggles cleanly on and off, and the resulting `Args`
//! struct preserves the user's intent.

use clap::Parser;
use link_assistant_agent::cli::Args;

#[test]
fn verbose_flag_off_by_default() {
    let args = Args::parse_from(["agent"]);
    assert!(!args.verbose);
}

#[test]
fn verbose_flag_can_be_enabled() {
    let args = Args::parse_from(["agent", "--verbose"]);
    assert!(args.verbose);
}

#[test]
fn dry_run_can_combine_with_verbose() {
    let args = Args::parse_from(["agent", "--verbose", "--dry-run"]);
    assert!(args.verbose);
    assert!(args.dry_run);
}

#[test]
fn dry_run_does_not_imply_verbose() {
    let args = Args::parse_from(["agent", "--dry-run"]);
    assert!(args.dry_run);
    assert!(!args.verbose);
}
