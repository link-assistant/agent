//! Rust counterpart of `js/tests/json-standard-unit.js`.
//!
//! The JavaScript implementation includes a JSON-standard module
//! (`js/src/json-standard/`) that converts events between the OpenCode JSON
//! format and the Claude streaming format. The Rust port currently emits
//! OpenCode-shaped JSON natively without a separate conversion layer, so
//! there is no equivalent module to test.
//!
//! These tests verify the surface that *is* observable in Rust today:
//! the `--json-standard` CLI flag accepts the same values as JS and rejects
//! invalid ones identically.

use clap::Parser;
use link_assistant_agent::cli::Args;

#[test]
fn default_json_standard_is_opencode() {
    let args = Args::parse_from(["agent"]);
    assert_eq!(args.json_standard, "opencode");
}

#[test]
fn accepts_opencode_value() {
    let args = Args::parse_from(["agent", "--json-standard", "opencode"]);
    assert_eq!(args.json_standard, "opencode");
}

#[test]
fn accepts_claude_value() {
    let args = Args::parse_from(["agent", "--json-standard", "claude"]);
    assert_eq!(args.json_standard, "claude");
}

#[test]
fn rejects_unknown_json_standard() {
    let result = Args::try_parse_from(["agent", "--json-standard", "nonsense"]);
    assert!(result.is_err());
}
