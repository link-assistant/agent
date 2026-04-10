/**
 * Default CLI configuration values.
 *
 * Centralizing defaults here ensures all code references the same value (#208).
 * When the default model changes, update this file only.
 */

/** Default model used when no `--model` CLI argument is provided. */
export const DEFAULT_MODEL = 'opencode/nemotron-3-super-free';

/** Default provider ID extracted from DEFAULT_MODEL. */
export const DEFAULT_PROVIDER_ID = DEFAULT_MODEL.split('/')[0];

/** Default model ID extracted from DEFAULT_MODEL. */
export const DEFAULT_MODEL_ID = DEFAULT_MODEL.split('/').slice(1).join('/');

/**
 * Default compaction model used when no `--compaction-model` CLI argument is provided.
 * gpt-5-nano has a 400K context window, larger than most free base models (~200K),
 * which allows compacting 100% of the base model's context without a safety margin.
 * The special value "same" means use the same model as `--model`.
 * @see https://github.com/link-assistant/agent/issues/219
 */
export const DEFAULT_COMPACTION_MODEL = 'opencode/gpt-5-nano';

/**
 * Default compaction models cascade, ordered from smallest/cheapest context to largest.
 * During compaction, the system tries each model in order. If the used context exceeds
 * a model's context limit, it skips to the next larger model. If a model's rate limit
 * is reached, it also skips to the next model.
 * The special value "same" means use the same model as `--model`.
 *
 * Parsed as links notation references sequence (single anonymous link):
 *   "(big-pickle minimax-m2.5-free nemotron-3-super-free gpt-5-nano same)"
 *
 * Context limits (approximate):
 *   big-pickle:            ~200K
 *   minimax-m2.5-free:     ~200K
 *   nemotron-3-super-free: ~262K (default model)
 *   gpt-5-nano:            ~400K
 *   same:                  (base model's context)
 *
 * Note: qwen3.6-plus-free was removed — free promotion ended April 2026.
 * @see https://github.com/link-assistant/agent/issues/242
 * @see https://github.com/link-assistant/agent/issues/232
 */
export const DEFAULT_COMPACTION_MODELS =
  '(big-pickle minimax-m2.5-free nemotron-3-super-free gpt-5-nano same)';

/**
 * Default compaction safety margin as a percentage of usable context window.
 * Applied only when the compaction model has a context window equal to or smaller
 * than the base model. When the compaction model has a larger context, the margin
 * is automatically set to 0 (allowing 100% context usage).
 * @see https://github.com/link-assistant/agent/issues/219
 */
export const DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT = 15;
