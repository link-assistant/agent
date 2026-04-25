//! Rust counterpart of `js/tests/retry-state.js`.
//!
//! The JS test exercises a session-scoped retry state machine that lives
//! in `js/src/session/`. The Rust port does not yet expose a dedicated
//! retry-state module, so the JS-only paths cannot be mirrored directly.
//!
//! These tests verify the related CLI surface that the JS state machine
//! is configured from: `--retry-timeout`, `--retry-on-rate-limits`, and
//! the centralized defaults that gate retry behavior.

use clap::Parser;
use link_assistant_agent::cli::Args;

#[test]
fn retry_state_starts_with_no_timeout() {
    let args = Args::parse_from(["agent"]);
    assert!(args.retry_timeout.is_none());
}

#[test]
fn retry_state_accepts_explicit_timeout() {
    let args = Args::parse_from(["agent", "--retry-timeout", "604800"]);
    assert_eq!(args.retry_timeout, Some(604800));
}

#[test]
fn retry_on_rate_limits_default_matches_js() {
    let args = Args::parse_from(["agent"]);
    assert!(args.retry_on_rate_limits());
}

#[test]
fn retry_on_rate_limits_can_be_disabled() {
    let args = Args::parse_from(["agent", "--no-retry-on-rate-limits"]);
    assert!(!args.retry_on_rate_limits());
}

#[test]
fn retry_timeout_zero_is_explicit_no_timeout() {
    let args = Args::parse_from(["agent", "--retry-timeout", "0"]);
    assert_eq!(args.retry_timeout, Some(0));
}
