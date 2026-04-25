//! Rust counterpart of `js/tests/model-validation.ts`.
//!
//! The JS test exercises model parsing, finish-reason inference, loop-exit
//! conditions and provider state. Most of that surface is JS-specific
//! (the AI SDK provider wrappers, the loop runtime, etc.). The Rust port
//! exposes the model parsing helpers via `link_assistant_agent::defaults`
//! and it is the only piece that can be mirrored 1:1 right now.
//!
//! These tests cover the equivalent Rust-side surface.

use link_assistant_agent::cli::DEFAULT_MODEL;
use link_assistant_agent::defaults::{
    default_model_from_env, default_model_parts_from_env, model_parts, ModelParts,
    DEFAULT_MODEL_ENV,
};

fn empty_env() -> impl Fn(&str) -> Option<String> {
    |_| None
}

fn env_with(key: &str, value: &str) -> impl Fn(&str) -> Option<String> {
    let key = key.to_string();
    let value = value.to_string();
    move |k| if k == key { Some(value.clone()) } else { None }
}

#[test]
fn default_model_falls_back_to_constant_when_env_missing() {
    assert_eq!(default_model_from_env(empty_env()), DEFAULT_MODEL);
}

#[test]
fn default_model_env_override_wins_over_constant() {
    assert_eq!(
        default_model_from_env(env_with(DEFAULT_MODEL_ENV, "groq/llama-3.3-70b-versatile")),
        "groq/llama-3.3-70b-versatile"
    );
}

#[test]
fn default_model_parts_split_on_first_slash() {
    let parts = default_model_parts_from_env(empty_env());
    assert_eq!(parts.provider_id, "opencode");
    assert_eq!(parts.model_id, "minimax-m2.5-free");
}

#[test]
fn default_model_parts_handle_nested_model_ids_via_env() {
    let parts = default_model_parts_from_env(env_with(
        DEFAULT_MODEL_ENV,
        "openrouter/anthropic/claude-sonnet-4",
    ));
    assert_eq!(parts.provider_id, "openrouter");
    assert_eq!(parts.model_id, "anthropic/claude-sonnet-4");
}

#[test]
fn model_parts_returns_empty_strings_for_blank_input() {
    let parts = model_parts("");
    assert_eq!(
        parts,
        ModelParts {
            provider_id: String::new(),
            model_id: String::new(),
        }
    );
}

#[test]
fn model_parts_handle_trailing_slash() {
    let parts = model_parts("opencode/");
    assert_eq!(parts.provider_id, "opencode");
    assert_eq!(parts.model_id, "");
}
