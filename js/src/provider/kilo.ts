import type { ModelsDev } from './models';

/** Built-in aliases use exact IDs from https://api.kilo.ai/api/gateway/models. */
export namespace Kilo {
  export const MODELS_URL = 'https://api.kilo.ai/api/gateway/models';

  function freeModel(
    id: string,
    name: string,
    context: number,
    output: number
  ): ModelsDev.Model {
    return {
      id,
      name,
      release_date: '',
      attachment: false,
      reasoning: true,
      temperature: true,
      tool_call: true,
      cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
      limit: { context, output },
      modalities: { input: ['text'], output: ['text'] },
      options: {},
    };
  }

  export const FREE_MODELS: Record<string, ModelsDev.Model> = {
    'nemotron-3-ultra-free': freeModel(
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'Nemotron 3 Ultra (Free)',
      1000000,
      65536
    ),
    'nemotron-3.5-lightning-free': freeModel(
      'nvidia/nemotron-3.5-lightning:free',
      'Nemotron 3.5 Lightning (Free)',
      1000000,
      65536
    ),
  };

  /**
   * Withdrawn built-in aliases that keep working temporarily. Each one maps to
   * the served alias in `FREE_MODELS` that replaces it, and every resolution
   * logs a warning naming the replacement. These are not catalog entries, so
   * the drift check (`scripts/check-model-drift.mjs`) does not look them up.
   *
   * Kilo stopped serving `nvidia/nemotron-3-super-120b-a12b:free`; only the
   * paid Super model remains on the gateway (#335).
   */
  export const DEPRECATED_ALIASES: Readonly<Record<string, string>> = {
    'nemotron-3-super-free': 'nemotron-3-ultra-free',
  };

  /**
   * Replacement for a deprecated alias, or `undefined`. Logs nothing; use
   * `resolveKiloDeprecatedAlias` from `./kilo-deprecation` to also warn.
   * This module stays free of runtime dependencies because
   * `scripts/check-default-models.mjs` imports it without installed packages.
   */
  export function deprecatedAliasTarget(modelID: string): string | undefined {
    return Object.hasOwn(DEPRECATED_ALIASES, modelID)
      ? DEPRECATED_ALIASES[modelID]
      : undefined;
  }

  /**
   * Text models models.dev lists for Kilo. Their IDs are the same on the
   * OpenRouter-compatible route this provider uses, so the curated aliases
   * above only add short names for the free Nemotron models (#334).
   */
  export function catalogueModels(
    provider: ModelsDev.Provider | undefined
  ): Record<string, ModelsDev.Model> {
    const result: Record<string, ModelsDev.Model> = {};
    for (const [key, model] of Object.entries(provider?.models ?? {})) {
      const output = model.modalities?.output ?? ['text'];
      if (!output.includes('text')) continue;
      // The catalogue points at the gateway route; ours is fixed.
      const { provider: _route, ...rest } = model;
      result[key] = structuredClone(rest);
    }
    return result;
  }
}
