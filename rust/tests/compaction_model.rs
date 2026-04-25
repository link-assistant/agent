//! Rust counterpart of `js/tests/compaction-model.ts`.
//!
//! The full session-compaction logic (`SessionCompaction.computeSafetyMarginRatio`,
//! `SessionCompaction.isOverflow`, `SessionCompaction.contextDiagnostics`) only
//! exists in the JavaScript implementation. The Rust port currently exposes
//! the compaction defaults via `link_assistant_agent::defaults` and the
//! `--compaction-model` / `--compaction-models` / `--compaction-safety-margin`
//! CLI flags via `link_assistant_agent::cli::Args`.
//!
//! These tests mirror the JS behavior at the surface that *is* observable
//! in Rust: the centralized defaults and the CLI override precedence.

use clap::Parser;
use link_assistant_agent::cli::{
    Args, DEFAULT_COMPACTION_MODEL, DEFAULT_COMPACTION_MODELS,
    DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT,
};
use link_assistant_agent::defaults::{
    default_compaction_model_from_env, default_compaction_models_from_env,
    default_compaction_safety_margin_percent_from_env, DEFAULT_COMPACTION_MODELS_ENV,
    DEFAULT_COMPACTION_MODEL_ENV, DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT_ENV,
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
fn default_compaction_model_matches_constant() {
    assert_eq!(
        default_compaction_model_from_env(empty_env()),
        DEFAULT_COMPACTION_MODEL
    );
}

#[test]
fn default_compaction_model_env_override() {
    assert_eq!(
        default_compaction_model_from_env(env_with(
            DEFAULT_COMPACTION_MODEL_ENV,
            "opencode/big-pickle"
        )),
        "opencode/big-pickle"
    );
}

#[test]
fn default_compaction_models_matches_constant() {
    assert_eq!(
        default_compaction_models_from_env(empty_env()),
        DEFAULT_COMPACTION_MODELS
    );
}

#[test]
fn default_compaction_models_env_override() {
    let custom = "(opencode/big-pickle same)";
    assert_eq!(
        default_compaction_models_from_env(env_with(DEFAULT_COMPACTION_MODELS_ENV, custom)),
        custom
    );
}

#[test]
fn default_compaction_safety_margin_matches_constant() {
    assert_eq!(
        default_compaction_safety_margin_percent_from_env(empty_env()),
        DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT
    );
}

#[test]
fn default_compaction_safety_margin_env_override() {
    assert_eq!(
        default_compaction_safety_margin_percent_from_env(env_with(
            DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT_ENV,
            "10"
        )),
        10
    );
}

#[test]
fn cli_flag_for_compaction_model_overrides_default() {
    let args = Args::parse_from(["agent", "--compaction-model", "opencode/big-pickle"]);
    assert_eq!(args.compaction_model, "opencode/big-pickle");
}

#[test]
fn cli_flag_for_compaction_models_overrides_default() {
    let args = Args::parse_from(["agent", "--compaction-models", "(opencode/gpt-5-nano same)"]);
    assert_eq!(args.compaction_models, "(opencode/gpt-5-nano same)");
}

#[test]
fn cli_flag_for_compaction_safety_margin_overrides_default() {
    let args = Args::parse_from(["agent", "--compaction-safety-margin", "30"]);
    assert_eq!(args.compaction_safety_margin, 30);
}

#[test]
fn default_safety_margin_is_25_percent() {
    assert_eq!(DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT, 25);
}
