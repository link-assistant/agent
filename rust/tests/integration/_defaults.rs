//! Centralized default-model accessor for integration tests.
//!
//! Mirrors `js/tests/integration/_defaults.js`.
//!
//! Re-exports the runtime defaults from `link_assistant_agent::defaults` so
//! test files import a single source of truth for the model string used by
//! the agent and by sibling tools like `opencode`. Override at test time via
//! `LINK_ASSISTANT_AGENT_DEFAULT_MODEL` (matches the runtime env var).
//!
//! Tests should never hard-code provider/model strings; pull them from here
//! so a single change to `rust/src/defaults.rs` (or a single env-var
//! override at run time) flows through every test in the tree.

pub use link_assistant_agent::defaults::{
    default_compaction_model, default_compaction_models,
    default_compaction_safety_margin_percent, default_model,
    DEFAULT_COMPACTION_MODEL, DEFAULT_COMPACTION_MODEL_ENV,
    DEFAULT_COMPACTION_MODELS, DEFAULT_COMPACTION_MODELS_ENV,
    DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT,
    DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT_ENV, DEFAULT_MODEL,
    DEFAULT_MODEL_ENV,
};

/// Resolve the default model string for tests, honouring the runtime env
/// override. Use this in CLI argument construction so the same value flows
/// to the agent and to sibling tools like `opencode`.
pub fn test_default_model() -> String {
    default_model()
}
