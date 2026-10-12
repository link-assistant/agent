import { Log } from '../util/log';
import type { ModelsDev } from './models';

export namespace OpenCodeZen {
  const log = Log.create({ service: 'opencode-zen' });
  export const MODELS_URL = 'https://opencode.ai/zen/v1/models';
  export const DEPRECATED_FREE_MODEL_IDS = new Set([
    'trinity-large-preview-free',
    'qwen3.6-plus-free',
    'kimi-k2.5-free',
    'minimax-m2.5-free',
    'ling-2.6-flash-free',
    'hy3-preview-free',
    'nemotron-3-super-free',
    'nemotron-3-ultra-free',
  ]);

  // Zen's free endpoints are restricted to OpenCode clients, so none is a default.
  export const FREE_MODEL_OVERRIDES: Record<
    string,
    Partial<ModelsDev.Model> & { name: string }
  > = {
    'nemotron-3.5-lightning-free': {
      name: 'Nemotron 3.5 Lightning Free',
      reasoning: true,
      limit: { context: 1000000, output: 65536 },
      provider: { npm: '@ai-sdk/openai-compatible' },
    },
    'big-pickle': {
      name: 'Big Pickle',
      reasoning: true,
      release_date: '2025-10-17',
      limit: { context: 200000, output: 128000 },
      provider: { npm: '@ai-sdk/openai-compatible' },
    },
  };

  function displayName(modelID: string) {
    return modelID
      .replace(/:free$/, '')
      .replace(/-free$/, ' Free')
      .split(/[-/]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  function isFreeModelID(modelID: string) {
    if (DEPRECATED_FREE_MODEL_IDS.has(modelID)) return false;
    return modelID.endsWith('-free') || modelID === 'big-pickle';
  }

  export async function fetchModelIDs(fetchFn: typeof fetch = fetch) {
    const response = await fetchFn(MODELS_URL, {
      headers: { 'User-Agent': 'agent-cli/1.0.0' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      log.warn(() => ({
        message: 'OpenCode Zen models endpoint returned non-OK response',
        status: response.status,
        statusText: response.statusText,
      }));
      return new Set<string>();
    }

    const body = (await response.json().catch(() => undefined)) as
      { data?: Array<{ id?: unknown }> } | undefined;
    const rows = Array.isArray(body?.data) ? body.data : [];
    return new Set(
      rows
        .map((row) => (typeof row.id === 'string' ? row.id : undefined))
        .filter((id): id is string => Boolean(id))
    );
  }

  export async function getLiveFreeModelInfo(
    modelID: string,
    fetchFn: typeof fetch = fetch
  ): Promise<ModelsDev.Model | undefined> {
    if (!isFreeModelID(modelID)) return undefined;

    const ids = await fetchModelIDs(fetchFn).catch((error) => {
      log.warn(() => ({
        message: 'failed to fetch OpenCode Zen live model list',
        modelID,
        error: error instanceof Error ? error.message : String(error),
      }));
      return new Set<string>();
    });
    if (!ids.has(modelID)) return undefined;

    return freeModelInfo(modelID);
  }

  export function freeModelInfo(modelID: string): ModelsDev.Model {
    const overrides = FREE_MODEL_OVERRIDES[modelID];
    return {
      id: modelID,
      name: overrides?.name ?? displayName(modelID),
      release_date: overrides?.release_date ?? '',
      attachment: overrides?.attachment ?? false,
      reasoning: overrides?.reasoning ?? modelID.includes('reasoning'),
      temperature: overrides?.temperature ?? true,
      tool_call: overrides?.tool_call ?? true,
      cost: overrides?.cost ?? { input: 0, output: 0, cache_read: 0 },
      limit: overrides?.limit ?? { context: 128000, output: 16384 },
      modalities: overrides?.modalities ?? {
        input: ['text'],
        output: ['text'],
      },
      options: overrides?.options ?? {},
      provider: overrides?.provider ?? { npm: '@ai-sdk/openai-compatible' },
    };
  }
}
