/**
 * Global default model configuration shared by runtime code and tests.
 *
 * Keep the hard-coded defaults here. Runtime helpers allow test runs and
 * local automation to override those defaults without editing source files.
 */

type EnvLike = Record<string, string | undefined>;

export interface DefaultConfigOptions {
  env?: EnvLike;
  defaultModel?: string | null;
  defaultCompactionModel?: string | null;
  defaultCompactionModels?: string | null;
  defaultCompactionSafetyMarginPercent?: number | string | null;
}

/** Default model used when no `--model` CLI argument is provided. */
export const DEFAULT_MODEL = 'opencode/minimax-m2.5-free';

/** Env var for overriding the default model in test runs and automation. */
export const DEFAULT_MODEL_ENV = 'LINK_ASSISTANT_AGENT_DEFAULT_MODEL';

/** Default compaction model used when no `--compaction-model` CLI argument is provided. */
export const DEFAULT_COMPACTION_MODEL = 'opencode/gpt-5-nano';

/** Env var for overriding the default compaction model in test runs and automation. */
export const DEFAULT_COMPACTION_MODEL_ENV =
  'LINK_ASSISTANT_AGENT_DEFAULT_COMPACTION_MODEL';

/**
 * Default compaction models cascade, ordered from smallest/cheapest context to largest.
 * During compaction, the system tries each model in order. If the used context exceeds
 * a model's context limit, it skips to the next larger model. If a model's rate limit
 * is reached, it also skips to the next model.
 * The special value "same" means use the same model as `--model`.
 *
 * Parsed as links notation references sequence (single anonymous link):
 *   "(big-pickle minimax-m2.5-free nemotron-3-super-free hy3-preview-free ling-2.6-flash-free gpt-5-nano same)"
 *
 * Context limits (approximate):
 *   big-pickle:             ~200K
 *   minimax-m2.5-free:      ~204K
 *   nemotron-3-super-free:  ~204K
 *   hy3-preview-free:       ~256K
 *   ling-2.6-flash-free:    ~262K
 *   gpt-5-nano:             ~400K
 *   same:                   (base model's context)
 *
 * Note: qwen3.6-plus-free was removed because the free promotion ended in April 2026.
 * Note: minimax-m2.5-free is the default model again as of issue #266.
 * @see https://github.com/link-assistant/agent/issues/266
 * @see https://github.com/link-assistant/agent/issues/242
 * @see https://github.com/link-assistant/agent/issues/232
 */
export const DEFAULT_COMPACTION_MODELS =
  '(big-pickle minimax-m2.5-free nemotron-3-super-free hy3-preview-free ling-2.6-flash-free gpt-5-nano same)';

/** Env var for overriding the default compaction cascade in test runs and automation. */
export const DEFAULT_COMPACTION_MODELS_ENV =
  'LINK_ASSISTANT_AGENT_DEFAULT_COMPACTION_MODELS';

/**
 * Default compaction safety margin as a percentage of usable context window.
 * Applied only when the compaction model has a context window equal to or smaller
 * than the base model. When the compaction model has a larger context, the margin
 * is automatically set to 0 (allowing 100% context usage).
 *
 * Increased from 15% to 25% to reduce probability of context overflow errors,
 * especially when providers return inaccurate or zero token counts.
 * Matches OpenCode upstream's 75% threshold (25% margin).
 * @see https://github.com/link-assistant/agent/issues/219
 * @see https://github.com/link-assistant/agent/issues/249
 */
export const DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT = 25;

/** Env var for overriding the default compaction safety margin in test runs and automation. */
export const DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT_ENV =
  'LINK_ASSISTANT_AGENT_DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT';

function clean(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function optionString(value: string | null | undefined): string | undefined {
  return clean(value);
}

function envString(env: EnvLike, key: string): string | undefined {
  return clean(env[key]);
}

function optionNumber(
  value: number | string | null | undefined
): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** Resolve the effective default model. CLI `--model` still takes precedence later. */
export function getDefaultModel(options: DefaultConfigOptions = {}): string {
  const env = options.env ?? process.env;
  return (
    optionString(options.defaultModel) ??
    envString(env, DEFAULT_MODEL_ENV) ??
    DEFAULT_MODEL
  );
}

export function getDefaultCompactionModel(
  options: DefaultConfigOptions = {}
): string {
  const env = options.env ?? process.env;
  return (
    optionString(options.defaultCompactionModel) ??
    envString(env, DEFAULT_COMPACTION_MODEL_ENV) ??
    DEFAULT_COMPACTION_MODEL
  );
}

export function getDefaultCompactionModels(
  options: DefaultConfigOptions = {}
): string {
  const env = options.env ?? process.env;
  return (
    optionString(options.defaultCompactionModels) ??
    envString(env, DEFAULT_COMPACTION_MODELS_ENV) ??
    DEFAULT_COMPACTION_MODELS
  );
}

export function getDefaultCompactionSafetyMarginPercent(
  options: DefaultConfigOptions = {}
): number {
  const env = options.env ?? process.env;
  return (
    optionNumber(options.defaultCompactionSafetyMarginPercent) ??
    optionNumber(env[DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT_ENV]) ??
    DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT
  );
}

export function parseModelParts(model: string): {
  providerID: string;
  modelID: string;
} {
  const [providerID, ...modelParts] = model.split('/');
  return {
    providerID,
    modelID: modelParts.join('/'),
  };
}

export function getDefaultModelParts(options: DefaultConfigOptions = {}): {
  providerID: string;
  modelID: string;
} {
  return parseModelParts(getDefaultModel(options));
}

/** Default provider ID extracted from DEFAULT_MODEL. */
export const DEFAULT_PROVIDER_ID = parseModelParts(DEFAULT_MODEL).providerID;

/** Default model ID extracted from DEFAULT_MODEL. */
export const DEFAULT_MODEL_ID = parseModelParts(DEFAULT_MODEL).modelID;
