import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { Global } from '../global';
import { Log } from '../util/log';
import type { ModelsDev } from './models';
import { EnvTemplate } from './env-template';

/**
 * Dynamic model discovery.
 *
 * Asks a provider's own model-listing endpoint (`GET /models` and friends)
 * which models it serves, so new models work without a code or docs update.
 *
 * Rules borrowed from hive-mind's model catalogue
 * (src/model-catalogue-sources.lib.mjs, src/model-catalogue-fetch.lib.mjs):
 * - listing requests never hit a billable endpoint (`assertTokenFreeUrl`);
 * - results are cached for at least one hour, an env override may only
 *   raise the TTL;
 * - live sources decide availability, models.dev only fills in metadata.
 *
 * @see https://github.com/link-assistant/agent/issues/334
 * @see https://github.com/link-assistant/hive-mind
 */
export namespace ModelDiscovery {
  const log = Log.create({ service: 'model-discovery' });

  export const DEFAULT_TTL_MS = 60 * 60 * 1000;
  export const TTL_ENV = 'LINK_ASSISTANT_AGENT_MODEL_DISCOVERY_TTL_MINUTES';
  export const DISABLE_ENV = 'LINK_ASSISTANT_AGENT_MODEL_DISCOVERY';
  export const DEFAULT_TIMEOUT_MS = 10_000;

  export type Shape = 'openai' | 'anthropic' | 'gemini' | 'cohere';

  export interface DiscoveredModel {
    id: string;
    name?: string;
    context?: number;
    output?: number;
    toolCall?: boolean;
    reasoning?: boolean;
    attachment?: boolean;
    input?: Array<'text' | 'image' | 'audio' | 'video' | 'pdf'>;
    free?: boolean;
    cost?: { input: number; output: number };
    releaseDate?: string;
    /** Alternative IDs the provider accepts for the same model (Pollinations). */
    aliases?: string[];
  }

  export interface ListingRequest {
    url: string;
    headers: Record<string, string>;
    shape: Shape;
  }

  export interface DiscoveryResult {
    status: 'ok' | 'skipped' | 'error';
    models: DiscoveredModel[];
    url?: string;
    error?: string;
    cached?: boolean;
  }

  /**
   * Paths that spend tokens. A listing request matching any of them is a
   * programming error and is refused before it leaves the process.
   */
  export const BILLABLE_PATH_PATTERNS: RegExp[] = [
    /\/v1\/messages(\/|$|\?)/i,
    /\/v1\/complete(\/|$|\?)/i,
    /\/chat\/completions(\/|$|\?)/i,
    /\/completions(\/|$|\?)/i,
    /\/responses(\/|$|\?)/i,
    /\/embeddings(\/|$|\?)/i,
    /:generatecontent/i,
    /:streamgeneratecontent/i,
    /:counttokens/i,
    /\/v1\/batches/i,
    /\/v1\/messages\/batches/i,
  ];

  export function isBillableUrl(url: string): boolean {
    let pathname = url;
    try {
      pathname = new URL(url).pathname;
    } catch {
      // keep the raw string
    }
    return BILLABLE_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
  }

  export function assertTokenFreeUrl(url: string) {
    if (isBillableUrl(url)) {
      throw new Error(
        `Refusing to call billable endpoint for model discovery: ${url}`
      );
    }
  }

  export function isEnabled(
    env: Record<string, string | undefined> = process.env
  ): boolean {
    const value = env[DISABLE_ENV]?.trim().toLowerCase();
    return !(value === '0' || value === 'false' || value === 'off');
  }

  /** Cache TTL. The env override can only make the cache live longer. */
  export function ttlMs(
    env: Record<string, string | undefined> = process.env
  ): number {
    const minutes = Number(env[TTL_ENV]);
    if (!Number.isFinite(minutes) || minutes <= 0) return DEFAULT_TTL_MS;
    return Math.max(DEFAULT_TTL_MS, minutes * 60 * 1000);
  }

  /** Base URLs the SDK packages use when no `baseURL` option is set. */
  export const DEFAULT_BASE_URLS: Record<string, string> = {
    '@ai-sdk/openai': 'https://api.openai.com/v1',
    '@ai-sdk/groq': 'https://api.groq.com/openai/v1',
    '@ai-sdk/mistral': 'https://api.mistral.ai/v1',
    '@ai-sdk/xai': 'https://api.x.ai/v1',
    '@ai-sdk/deepinfra': 'https://api.deepinfra.com/v1/openai',
    '@ai-sdk/togetherai': 'https://api.together.xyz/v1',
    '@ai-sdk/cerebras': 'https://api.cerebras.ai/v1',
    '@ai-sdk/fireworks': 'https://api.fireworks.ai/inference/v1',
    '@ai-sdk/deepseek': 'https://api.deepseek.com/v1',
    '@ai-sdk/alibaba': 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    '@openrouter/ai-sdk-provider': 'https://openrouter.ai/api/v1',
    '@ai-sdk/anthropic': 'https://api.anthropic.com/v1',
    '@ai-sdk/google': 'https://generativelanguage.googleapis.com/v1beta',
  };

  /** Model-listing URLs that differ from `${baseURL}/models`. */
  export const LISTING_URL_OVERRIDES: Record<string, string> = {
    '@ai-sdk/gateway': 'https://ai-gateway.vercel.sh/v1/models',
    kilo: 'https://api.kilo.ai/api/gateway/models',
  };

  /**
   * Packages whose model list is not reachable with a plain API key
   * (cloud IAM, deployment-scoped or no listing endpoint at all).
   */
  const UNSUPPORTED_PACKAGES = new Set([
    '@ai-sdk/amazon-bedrock',
    '@ai-sdk/amazon-bedrock/mantle',
    '@ai-sdk/google-vertex',
    '@ai-sdk/google-vertex/anthropic',
    '@ai-sdk/azure',
    '@ai-sdk/perplexity',
    'gitlab-ai-provider',
    'ai-gateway-provider',
  ]);

  /** Providers that are synthetic or handled by a dedicated module. */
  const UNSUPPORTED_PROVIDERS = new Set([
    'link-assistant',
    'link-assistant/cache',
    'opencode',
    'formal-ai',
    'formalai',
    '@link-assistant',
  ]);

  function trimSlash(url: string) {
    return url.replace(/\/+$/, '');
  }

  export function listingRequest(input: {
    providerID: string;
    npm?: string;
    baseURL?: string;
    apiKey?: string;
    headers?: Record<string, string>;
  }): ListingRequest | undefined {
    const npm = input.npm ?? '@ai-sdk/openai-compatible';
    if (UNSUPPORTED_PROVIDERS.has(input.providerID)) return undefined;
    if (UNSUPPORTED_PACKAGES.has(npm)) return undefined;
    const apiKey = input.apiKey || undefined;
    const headers: Record<string, string> = { ...(input.headers ?? {}) };

    const override =
      LISTING_URL_OVERRIDES[input.providerID] ?? LISTING_URL_OVERRIDES[npm];
    const base = input.baseURL ?? DEFAULT_BASE_URLS[npm];
    if (!override && (!base || EnvTemplate.isTemplate(base))) return undefined;

    if (npm === '@ai-sdk/anthropic') {
      if (apiKey) headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      return {
        url: `${trimSlash(base!)}/models?limit=1000`,
        headers,
        shape: 'anthropic',
      };
    }
    if (npm === '@ai-sdk/google') {
      if (apiKey) headers['x-goog-api-key'] = apiKey;
      return {
        url: `${trimSlash(base!)}/models?pageSize=1000`,
        headers,
        shape: 'gemini',
      };
    }
    if (npm === '@ai-sdk/cohere') {
      if (apiKey) headers['authorization'] = `Bearer ${apiKey}`;
      const root = trimSlash(input.baseURL ?? 'https://api.cohere.com/v2');
      return {
        url: `${root.replace(/\/v\d+$/, '')}/v1/models?endpoint=chat&page_size=1000`,
        headers,
        shape: 'cohere',
      };
    }
    if (apiKey) headers['authorization'] = `Bearer ${apiKey}`;
    return {
      url: override ?? `${trimSlash(base!)}/models`,
      headers,
      shape: 'openai',
    };
  }

  function num(value: unknown): number | undefined {
    const n = typeof value === 'string' ? Number(value) : value;
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined;
  }

  function price(value: unknown): number | undefined {
    const n = typeof value === 'string' ? Number(value) : value;
    return typeof n === 'number' && Number.isFinite(n) && n >= 0
      ? n
      : undefined;
  }

  function date(value: unknown): string | undefined {
    if (typeof value === 'number' && value > 0) {
      const ms = value < 1e12 ? value * 1000 : value;
      return new Date(ms).toISOString().slice(0, 10);
    }
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
      return value.slice(0, 10);
    }
    return undefined;
  }

  const MODALITIES = new Set(['text', 'image', 'audio', 'video', 'pdf']);

  function modalities(value: unknown): DiscoveredModel['input'] {
    if (!Array.isArray(value)) return undefined;
    const list = value
      .map((item) => String(item).toLowerCase())
      .map((item) => (item === 'file' ? 'pdf' : item))
      .filter((item) => MODALITIES.has(item));
    return list.length
      ? (Array.from(new Set(list)) as DiscoveredModel['input'])
      : undefined;
  }

  function isFreeId(id: string) {
    return /(:free|-free)$/i.test(id) || id === 'openrouter/free';
  }

  function normalizeOpenAI(item: any): DiscoveredModel | undefined {
    if (!item || typeof item.id !== 'string' || !item.id) return undefined;
    if (item.type === 'embedding' || item.type === 'embeddings') return;
    if (item.supports_chat === false) return undefined;
    // gpt4free marks image generators with `image: true`
    if (item.image === true && item.vision !== true) return undefined;
    const outputs = modalities(
      item.architecture?.output_modalities ??
        item.output_modalities ??
        item.modalities?.output
    );
    if (outputs && !outputs.includes('text')) return undefined;

    const input =
      modalities(
        item.architecture?.input_modalities ??
          item.input_modalities ??
          item.modalities?.input
      ) ?? (item.vision === true ? ['text', 'image'] : undefined);
    const params: string[] = Array.isArray(item.supported_parameters)
      ? item.supported_parameters
      : [];
    const pricing = item.pricing ?? {};
    const inputPrice = price(pricing.prompt ?? pricing.input);
    const outputPrice = price(pricing.completion ?? pricing.output);
    const cost =
      inputPrice !== undefined && outputPrice !== undefined
        ? {
            input: Math.round(inputPrice * 1e6 * 1e6) / 1e6,
            output: Math.round(outputPrice * 1e6 * 1e6) / 1e6,
          }
        : undefined;
    const free =
      isFreeId(item.id) ||
      item.tier === 'free' ||
      item.paid_only === false ||
      item.is_free === true ||
      (cost !== undefined && cost.input === 0 && cost.output === 0);

    const toolCall =
      typeof item.tools === 'boolean'
        ? item.tools
        : typeof item.supports_tools === 'boolean'
          ? item.supports_tools
          : typeof item.capabilities?.trained_for_tool_use === 'boolean'
            ? item.capabilities.trained_for_tool_use
            : params.length
              ? params.includes('tools')
              : undefined;
    const reasoning =
      typeof item.reasoning === 'boolean'
        ? item.reasoning
        : params.length
          ? params.includes('reasoning') || params.includes('include_reasoning')
          : undefined;

    return {
      id: item.id,
      name:
        item.name ?? item.display_name ?? item.title ?? item.description_short,
      context: num(
        item.context_length ??
          item.context_window ??
          item.max_model_len ??
          item.max_context_length ??
          item.top_provider?.context_length ??
          item.limits?.context
      ),
      output: num(
        item.top_provider?.max_completion_tokens ??
          item.max_output_tokens ??
          item.max_completion_tokens ??
          item.max_tokens ??
          item.limits?.output
      ),
      toolCall,
      reasoning,
      attachment: input ? input.some((m) => m !== 'text') : undefined,
      input,
      free,
      cost: free ? { input: 0, output: 0 } : cost,
      releaseDate: date(item.created ?? item.created_at),
      ...(Array.isArray(item.aliases) && item.aliases.length
        ? {
            aliases: item.aliases.filter(
              (alias: unknown): alias is string =>
                typeof alias === 'string' && alias.length > 0
            ),
          }
        : {}),
    };
  }

  function normalizeAnthropic(item: any): DiscoveredModel | undefined {
    if (!item || typeof item.id !== 'string') return undefined;
    return {
      id: item.id,
      name: item.display_name,
      context: num(item.max_input_tokens ?? item.context_window),
      output: num(item.max_tokens ?? item.max_output_tokens),
      releaseDate: date(item.created_at),
    };
  }

  function normalizeGemini(item: any): DiscoveredModel | undefined {
    if (!item || typeof item.name !== 'string') return undefined;
    const methods: string[] = item.supportedGenerationMethods ?? [];
    if (methods.length && !methods.includes('generateContent')) return;
    return {
      id: item.name.replace(/^models\//, ''),
      name: item.displayName,
      context: num(item.inputTokenLimit),
      output: num(item.outputTokenLimit),
      reasoning: typeof item.thinking === 'boolean' ? item.thinking : undefined,
    };
  }

  function normalizeCohere(item: any): DiscoveredModel | undefined {
    if (!item || typeof item.name !== 'string') return undefined;
    const endpoints: string[] = item.endpoints ?? [];
    if (endpoints.length && !endpoints.includes('chat')) return undefined;
    const features: string[] = item.features ?? [];
    return {
      id: item.name,
      context: num(item.context_length),
      toolCall: features.length ? features.includes('tools') : undefined,
      attachment: features.includes('vision') || undefined,
    };
  }

  /** Turn a listing payload into discovered models (deduplicated, sorted). */
  export function normalize(shape: Shape, payload: any): DiscoveredModel[] {
    const items: any[] = Array.isArray(payload)
      ? payload
      : (payload?.data ?? payload?.models ?? []);
    if (!Array.isArray(items)) return [];
    const fn =
      shape === 'anthropic'
        ? normalizeAnthropic
        : shape === 'gemini'
          ? normalizeGemini
          : shape === 'cohere'
            ? normalizeCohere
            : normalizeOpenAI;
    const seen = new Map<string, DiscoveredModel>();
    for (const item of items) {
      const model = fn(item);
      if (model && !seen.has(model.id)) seen.set(model.id, model);
    }
    return Array.from(seen.values()).sort((a, b) => a.id.localeCompare(b.id));
  }

  function catalogueKeys(id: string): string[] {
    const keys = [id];
    const bare = id.replace(/(:free|-free)$/i, '');
    if (bare !== id) keys.push(bare);
    for (const key of [...keys]) {
      const slash = key.lastIndexOf('/');
      if (slash >= 0) keys.push(key.slice(slash + 1));
    }
    return keys;
  }

  /**
   * Find models.dev metadata for a discovered model ID anywhere in the
   * catalogue (exact ID first, then without vendor prefix / free suffix).
   */
  export function catalogueMetadata(
    database: Record<string, ModelsDev.Provider>,
    id: string,
    preferredProviderID?: string
  ): ModelsDev.Model | undefined {
    const providers = Object.values(database);
    if (preferredProviderID && database[preferredProviderID]) {
      providers.unshift(database[preferredProviderID]);
    }
    for (const key of catalogueKeys(id)) {
      for (const provider of providers) {
        const model = provider.models?.[key];
        if (model) return model;
      }
    }
    return undefined;
  }

  export function toModelInfo(
    model: DiscoveredModel,
    options: { npm?: string; metadata?: ModelsDev.Model } = {}
  ): ModelsDev.Model {
    const meta = options.metadata;
    const context = model.context ?? meta?.limit?.context ?? 128000;
    const output =
      model.output ?? meta?.limit?.output ?? Math.min(16384, context);
    const input = model.input ?? meta?.modalities?.input ?? ['text'];
    const cost =
      model.cost ??
      (model.free
        ? { input: 0, output: 0 }
        : meta?.cost
          ? { input: meta.cost.input, output: meta.cost.output }
          : { input: 0, output: 0 });
    return {
      id: model.id,
      name: model.name ?? meta?.name ?? model.id,
      release_date: model.releaseDate ?? meta?.release_date ?? '',
      attachment: model.attachment ?? meta?.attachment ?? false,
      reasoning: model.reasoning ?? meta?.reasoning ?? false,
      temperature: meta?.temperature ?? true,
      tool_call: model.toolCall ?? meta?.tool_call ?? true,
      cost: { ...cost, cache_read: 0, cache_write: 0 },
      limit: { context, output: Math.min(output, context) },
      modalities: { input, output: ['text'] },
      options: {},
      ...(options.npm ? { provider: { npm: options.npm } } : {}),
    };
  }

  const memory = new Map<string, { at: number; result: DiscoveryResult }>();

  function cacheKey(providerID: string, request: ListingRequest) {
    const secret =
      request.headers['authorization'] ??
      request.headers['x-api-key'] ??
      request.headers['x-goog-api-key'] ??
      '';
    return crypto
      .createHash('sha256')
      .update(`${providerID}\n${request.url}\n${secret}`)
      .digest('hex')
      .slice(0, 24);
  }

  function cacheFile(key: string) {
    return path.join(Global.Path.cache, 'model-discovery', `${key}.json`);
  }

  async function readDisk(key: string, ttl: number) {
    try {
      const raw = JSON.parse(await fs.readFile(cacheFile(key), 'utf8'));
      if (typeof raw?.at !== 'number' || Date.now() - raw.at > ttl) return;
      return raw as { at: number; result: DiscoveryResult };
    } catch {
      return undefined;
    }
  }

  async function writeDisk(key: string, entry: object) {
    try {
      await fs.mkdir(path.dirname(cacheFile(key)), { recursive: true });
      await fs.writeFile(cacheFile(key), JSON.stringify(entry));
    } catch (error) {
      log.debug(() => ({
        message: 'failed to write model discovery cache',
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  /** Forget cached listings (all providers, memory only). */
  export function clearMemoryCache() {
    memory.clear();
  }

  export async function fetchListing(
    request: ListingRequest,
    options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}
  ): Promise<DiscoveredModel[]> {
    assertTokenFreeUrl(request.url);
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(request.url, {
      method: 'GET',
      headers: { accept: 'application/json', ...request.headers },
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${request.url}`);
    }
    return normalize(request.shape, await response.json());
  }

  /**
   * List the models a provider currently serves.
   * Never throws; failures come back as `{ status: 'error' }`.
   */
  export async function discover(input: {
    providerID: string;
    npm?: string;
    baseURL?: string;
    apiKey?: string;
    headers?: Record<string, string>;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    force?: boolean;
    env?: Record<string, string | undefined>;
  }): Promise<DiscoveryResult> {
    const env = input.env ?? process.env;
    if (!isEnabled(env)) {
      return { status: 'skipped', models: [], error: `${DISABLE_ENV}=off` };
    }
    const request = listingRequest(input);
    if (!request) {
      return {
        status: 'skipped',
        models: [],
        error: 'provider has no token-free model listing endpoint',
      };
    }
    const ttl = ttlMs(env);
    const key = cacheKey(input.providerID, request);
    if (!input.force) {
      const hit = memory.get(key) ?? (await readDisk(key, ttl));
      if (hit && Date.now() - hit.at <= ttl) {
        memory.set(key, hit);
        return { ...hit.result, cached: true };
      }
    }
    try {
      const models = await fetchListing(request, input);
      const result: DiscoveryResult = {
        status: 'ok',
        models,
        url: request.url,
      };
      const entry = { at: Date.now(), result };
      memory.set(key, entry);
      await writeDisk(key, entry);
      log.info(() => ({
        message: 'discovered provider models',
        provider: input.providerID,
        url: request.url,
        count: models.length,
      }));
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.info(() => ({
        message: 'model discovery failed',
        provider: input.providerID,
        url: request.url,
        error: message,
      }));
      return { status: 'error', models: [], url: request.url, error: message };
    }
  }

  export function findModel(
    models: DiscoveredModel[],
    modelID: string
  ): DiscoveredModel | undefined {
    const wanted = modelID.replace(/^models\//, '');
    const lower = wanted.toLowerCase();
    return (
      models.find((m) => m.id === wanted) ??
      models.find((m) => m.id.toLowerCase() === lower) ??
      models.find((m) => m.aliases?.some((a) => a.toLowerCase() === lower))
    );
  }
}
