//! Rust counterpart of `js/tests/sse-usage-extractor.ts`.
//!
//! The JS test exercises an SSE chunk parser that pulls usage statistics
//! out of streaming responses (OpenRouter, OpenCode Zen, etc.). The Rust
//! port does not yet ship a streaming SSE parser. When it does, this file
//! should mirror the JS test cases byte-for-byte.
//!
//! For now we verify the related Rust surface: the `--json-standard` flag
//! that selects the consumer format and the centralized defaults that the
//! parser anchors against.

use clap::Parser;
use link_assistant_agent::cli::Args;

#[test]
fn json_standard_defaults_to_opencode() {
    let args = Args::parse_from(["agent"]);
    assert_eq!(args.json_standard, "opencode");
}

#[test]
fn json_standard_supports_claude_format() {
    let args = Args::parse_from(["agent", "--json-standard", "claude"]);
    assert_eq!(args.json_standard, "claude");
}
