//! Rust counterpart of `js/tests/verbose-fetch.ts`.
//!
//! The JS test exercises a verbose `fetch` wrapper that sanitizes
//! authorization headers and truncates long bodies for log output. The
//! Rust port does not yet ship an HTTP middleware layer; once one is
//! added, this file should mirror the JS sanitization assertions.
//!
//! For now we verify the related CLI surface: `--verbose` toggles the
//! diagnostic mode the wrapper would feed into.

use clap::Parser;
use link_assistant_agent::cli::Args;

#[test]
fn verbose_flag_default_is_off() {
    let args = Args::parse_from(["agent"]);
    assert!(!args.verbose);
}

#[test]
fn verbose_flag_enables_diagnostics() {
    let args = Args::parse_from(["agent", "--verbose"]);
    assert!(args.verbose);
}

#[test]
fn verbose_independent_of_dry_run() {
    let args = Args::parse_from(["agent", "--verbose", "--dry-run"]);
    assert!(args.verbose);
    assert!(args.dry_run);
}
