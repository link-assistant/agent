//! Rust counterpart of `js/tests/retry-fetch.ts`.
//!
//! The JS test exercises the retry/back-off wrapper around `fetch`. The
//! Rust port currently uses `reqwest` for HTTP without a centralized
//! retry layer; once one is added, this file should mirror the JS test
//! cases (rate limiting, retry-after header parsing, signal isolation,
//! etc.).
//!
//! For now we verify the related CLI surface that the JS suite implicitly
//! relies on: `--retry-timeout`, `--retry-on-rate-limits` and
//! `--no-retry-on-rate-limits` are wired through `Args`.

use clap::Parser;
use link_assistant_agent::cli::Args;

#[test]
fn retry_timeout_defaults_to_unset() {
    let args = Args::parse_from(["agent"]);
    assert!(args.retry_timeout.is_none());
}

#[test]
fn retry_timeout_can_be_overridden() {
    let args = Args::parse_from(["agent", "--retry-timeout", "30000"]);
    assert_eq!(args.retry_timeout, Some(30000));
}

#[test]
fn retry_on_rate_limits_defaults_to_true() {
    let args = Args::parse_from(["agent"]);
    assert!(args.retry_on_rate_limits());
}

#[test]
fn no_retry_on_rate_limits_disables_it() {
    let args = Args::parse_from(["agent", "--no-retry-on-rate-limits"]);
    assert!(!args.retry_on_rate_limits());
}
