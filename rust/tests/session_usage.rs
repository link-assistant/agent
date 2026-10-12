//! Rust counterpart of `js/tests/session-usage.ts`.
//!
//! The JS test exercises the session-usage tracking module
//! (`js/src/session/usage.ts`), which converts streaming usage events from
//! the AI SDK into a per-session token-cost ledger. The Rust port does not
//! yet ship a session/usage module, so the JS-only paths cannot be mirrored.
//!
//! When the Rust port grows a session/usage module, this file should
//! mirror the JS test cases (token totals, decimal precision, finish
//! reasons, cache read/write tracking, metadata fallback). For now we
//! verify that the constants the JS tests anchor to (default model, free
//! tier identifiers) round-trip through the Rust defaults helpers.

use link_assistant_agent::cli::DEFAULT_MODEL;
use link_assistant_agent::defaults::default_model_parts;

#[test]
fn default_model_identifies_the_documented_zero_cost_model() {
    let parts = default_model_parts();
    assert_eq!(parts.provider_id, "opencode");
    // Big Pickle is listed at zero cost without a "free" suffix in its ID.
    assert_eq!(parts.model_id, "big-pickle");
}

#[test]
fn default_model_full_string_round_trips() {
    let parts = default_model_parts();
    let combined = format!("{}/{}", parts.provider_id, parts.model_id);
    assert_eq!(combined, DEFAULT_MODEL);
}
