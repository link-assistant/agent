//! Rust counterpart of `js/tests/model-strict-validation.ts`.
//!
//! The JS suite exercises strict validation against the OpenCode Zen and
//! models.dev metadata endpoints. The Rust port does not yet hit those
//! endpoints, and storage migration / provider lookup logic is JS-only.
//!
//! These tests verify the surface that *is* observable in Rust: the
//! centralized default constants are well-formed, every provider id and
//! model id pair extracted from the defaults is non-empty, and CLI parsing
//! preserves the model string exactly.

use clap::Parser;
use link_assistant_agent::cli::{Args, DEFAULT_COMPACTION_MODEL, DEFAULT_MODEL};
use link_assistant_agent::defaults::{model_parts, ModelParts};

fn assert_well_formed_model(model: &str) {
    let ModelParts {
        provider_id,
        model_id,
    } = model_parts(model);
    assert!(
        !provider_id.is_empty(),
        "provider id should not be empty for {model}"
    );
    assert!(
        !model_id.is_empty(),
        "model id should not be empty for {model}"
    );
}

#[test]
fn default_model_string_has_provider_and_model() {
    assert_well_formed_model(DEFAULT_MODEL);
}

#[test]
fn default_compaction_model_string_has_provider_and_model() {
    assert_well_formed_model(DEFAULT_COMPACTION_MODEL);
}

#[test]
fn cli_round_trips_provider_qualified_model() {
    let args = Args::parse_from(["agent", "--model", DEFAULT_MODEL]);
    assert_eq!(args.model, DEFAULT_MODEL);
    assert_well_formed_model(&args.model);
}

#[test]
fn parsing_unusual_models_does_not_panic() {
    // Defensive: any provider/model string the user writes should parse
    // without panicking. The runtime validates against the provider later.
    for model in [
        "opencode/minimax-m2.5-free",
        "groq/llama-3.3-70b-versatile",
        "openrouter/openai/gpt-4o",
        "anthropic/claude-opus-4-1",
        "google/gemini-3-pro",
    ] {
        let parts = model_parts(model);
        assert!(!parts.provider_id.is_empty());
    }
}
