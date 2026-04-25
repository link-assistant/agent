//! Global default model configuration shared by runtime code and tests.
//!
//! Keep the hard-coded defaults here. Runtime helpers allow test runs and
//! automation to override those defaults without editing source files.

/// Default model used when no `--model` CLI argument is provided.
pub const DEFAULT_MODEL: &str = "opencode/minimax-m2.5-free";

/// Env var for overriding the default model in test runs and automation.
pub const DEFAULT_MODEL_ENV: &str = "LINK_ASSISTANT_AGENT_DEFAULT_MODEL";

/// Default compaction model used when no `--compaction-model` CLI argument is provided.
/// gpt-5-nano has a 400K context window, larger than most free base models (~200K).
pub const DEFAULT_COMPACTION_MODEL: &str = "opencode/gpt-5-nano";

/// Env var for overriding the default compaction model in test runs and automation.
pub const DEFAULT_COMPACTION_MODEL_ENV: &str = "LINK_ASSISTANT_AGENT_DEFAULT_COMPACTION_MODEL";

/// Default compaction models cascade, ordered from smallest/cheapest context to largest.
/// During compaction, the system tries each model in order.
pub const DEFAULT_COMPACTION_MODELS: &str =
    "(big-pickle minimax-m2.5-free nemotron-3-super-free hy3-preview-free ling-2.6-flash-free gpt-5-nano same)";

/// Env var for overriding the default compaction cascade in test runs and automation.
pub const DEFAULT_COMPACTION_MODELS_ENV: &str = "LINK_ASSISTANT_AGENT_DEFAULT_COMPACTION_MODELS";

/// Default compaction safety margin as a percentage of usable context window.
/// Increased from 15% to 25% to reduce probability of context overflow errors.
/// @see https://github.com/link-assistant/agent/issues/249
pub const DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT: u32 = 25;

/// Env var for overriding the default compaction safety margin in test runs and automation.
pub const DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT_ENV: &str =
    "LINK_ASSISTANT_AGENT_DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelParts {
    pub provider_id: String,
    pub model_id: String,
}

fn clean(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub fn default_model_from_env(getenv: impl Fn(&str) -> Option<String>) -> String {
    clean(getenv(DEFAULT_MODEL_ENV)).unwrap_or_else(|| DEFAULT_MODEL.to_string())
}

pub fn default_model() -> String {
    default_model_from_env(|key| std::env::var(key).ok())
}

pub fn default_compaction_model_from_env(getenv: impl Fn(&str) -> Option<String>) -> String {
    clean(getenv(DEFAULT_COMPACTION_MODEL_ENV))
        .unwrap_or_else(|| DEFAULT_COMPACTION_MODEL.to_string())
}

pub fn default_compaction_model() -> String {
    default_compaction_model_from_env(|key| std::env::var(key).ok())
}

pub fn default_compaction_models_from_env(getenv: impl Fn(&str) -> Option<String>) -> String {
    clean(getenv(DEFAULT_COMPACTION_MODELS_ENV))
        .unwrap_or_else(|| DEFAULT_COMPACTION_MODELS.to_string())
}

pub fn default_compaction_models() -> String {
    default_compaction_models_from_env(|key| std::env::var(key).ok())
}

pub fn default_compaction_safety_margin_percent_from_env(
    getenv: impl Fn(&str) -> Option<String>,
) -> u32 {
    clean(getenv(DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT_ENV))
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT)
}

pub fn default_compaction_safety_margin_percent() -> u32 {
    default_compaction_safety_margin_percent_from_env(|key| std::env::var(key).ok())
}

pub fn model_parts(model: &str) -> ModelParts {
    let mut parts = model.split('/');
    let provider_id = parts.next().unwrap_or_default().to_string();
    let model_id = parts.collect::<Vec<_>>().join("/");
    ModelParts {
        provider_id,
        model_id,
    }
}

pub fn default_model_parts_from_env(getenv: impl Fn(&str) -> Option<String>) -> ModelParts {
    model_parts(&default_model_from_env(getenv))
}

pub fn default_model_parts() -> ModelParts {
    model_parts(&default_model())
}
