//! Rust counterpart of `js/tests/agent-config.ts`.
//!
//! The JavaScript implementation exposes a runtime config module
//! (`js/src/config/config.ts`) that mirrors selected CLI flags into a shared
//! object accessible from anywhere in the process. The Rust implementation
//! threads `clap::Parser`-derived `Args` directly through the call graph, so
//! there is no equivalent global config object to test in isolation.
//!
//! These tests verify the equivalent surface that *is* observable in Rust:
//! the parsed `Args` struct exposes the same fields with the same defaults
//! that the JS `config` object snapshots.

use clap::Parser;
use link_assistant_agent::cli::Args;

#[test]
fn verbose_defaults_to_false() {
    let args = Args::parse_from(["agent"]);
    assert!(!args.verbose);
}

#[test]
fn dry_run_defaults_to_false() {
    let args = Args::parse_from(["agent"]);
    assert!(!args.dry_run);
}

#[test]
fn output_response_model_defaults_to_true() {
    let args = Args::parse_from(["agent"]);
    assert!(args.output_response_model());
}

#[test]
fn summarize_session_defaults_to_true() {
    let args = Args::parse_from(["agent"]);
    assert!(args.summarize_session());
}

#[test]
fn retry_on_rate_limits_defaults_to_true() {
    let args = Args::parse_from(["agent"]);
    assert!(args.retry_on_rate_limits());
}

#[test]
fn parses_verbose_flag() {
    let args = Args::parse_from(["agent", "--verbose"]);
    assert!(args.verbose);
}

#[test]
fn parses_dry_run_flag() {
    let args = Args::parse_from(["agent", "--dry-run"]);
    assert!(args.dry_run);
}

#[test]
fn parses_retry_timeout_value() {
    let args = Args::parse_from(["agent", "--retry-timeout", "5000"]);
    assert_eq!(args.retry_timeout, Some(5000));
}

#[test]
fn no_output_response_model_disables_it() {
    let args = Args::parse_from(["agent", "--no-output-response-model"]);
    assert!(!args.output_response_model());
}

#[test]
fn no_summarize_session_disables_it() {
    let args = Args::parse_from(["agent", "--no-summarize-session"]);
    assert!(!args.summarize_session());
}
