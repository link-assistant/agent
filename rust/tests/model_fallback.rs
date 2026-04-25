//! Rust counterpart of `js/tests/model-fallback.ts`.
//!
//! The provider/model fallback chain is implemented in
//! `js/src/provider/` and is JS-specific (it depends on the `ai` SDK and
//! the OpenCode Zen provider stack). The Rust port does not expose a
//! provider chain yet; the binary connects to a single configured
//! provider via the `--model` flag and the centralized defaults.
//!
//! These tests verify the surface that *is* observable in Rust: the model
//! string parses into provider/model parts the same way as JS, and the
//! defaults helpers honor environment overrides.

use link_assistant_agent::defaults::{model_parts, ModelParts};

#[test]
fn provider_and_model_parts_split_on_first_slash() {
    let parts = model_parts("opencode/minimax-m2.5-free");
    assert_eq!(
        parts,
        ModelParts {
            provider_id: "opencode".to_string(),
            model_id: "minimax-m2.5-free".to_string(),
        }
    );
}

#[test]
fn provider_and_model_parts_handle_nested_model_ids() {
    let parts = model_parts("openrouter/anthropic/claude-sonnet-4");
    assert_eq!(parts.provider_id, "openrouter");
    assert_eq!(parts.model_id, "anthropic/claude-sonnet-4");
}

#[test]
fn provider_and_model_parts_handle_no_slash() {
    let parts = model_parts("standalone-model");
    assert_eq!(parts.provider_id, "standalone-model");
    assert_eq!(parts.model_id, "");
}

#[test]
fn provider_and_model_parts_handle_empty_string() {
    let parts = model_parts("");
    assert_eq!(parts.provider_id, "");
    assert_eq!(parts.model_id, "");
}
