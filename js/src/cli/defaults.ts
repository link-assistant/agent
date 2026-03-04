/**
 * Default CLI configuration values.
 *
 * Centralizing defaults here ensures all code references the same value (#208).
 * When the default model changes, update this file only.
 */

/** Default model used when no `--model` CLI argument is provided. */
export const DEFAULT_MODEL = 'opencode/minimax-m2.5-free';

/** Default provider ID extracted from DEFAULT_MODEL. */
export const DEFAULT_PROVIDER_ID = DEFAULT_MODEL.split('/')[0];

/** Default model ID extracted from DEFAULT_MODEL. */
export const DEFAULT_MODEL_ID = DEFAULT_MODEL.split('/').slice(1).join('/');
