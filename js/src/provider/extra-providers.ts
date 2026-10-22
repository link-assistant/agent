import type { ModelsDev } from './models';

/**
 * Providers that models.dev (the catalogue OpenCode uses) does not list:
 * gpt4free (https://github.com/xtekky/gpt4free) and its hosted gateway,
 * Pollinations, other OpenAI-compatible endpoints from gpt4free's provider
 * list, and local inference servers.
 *
 * A definition only fills a gap: if models.dev ever adds the same provider ID,
 * the models.dev entry wins. Seed models are a starting point, the real list
 * comes from the provider's `/models` endpoint (see `ModelDiscovery`).
 *
 * @see https://github.com/link-assistant/agent/issues/334
 */
export namespace ExtraProviders {
  export interface Definition {
    id: string;
    name: string;
    /** Default OpenAI-compatible base URL. */
    api: string;
    /** Env vars that override the base URL, first match wins. */
    baseURLEnv?: string[];
    /** Optional or required API key env vars. */
    env: string[];
    doc: string;
    /**
     * Usable without credentials (local servers, anonymous free tiers).
     * Such providers stay hidden until explicitly requested with
     * `--model <provider>/<model>` or configured, so they never take over
     * default or short-name resolution.
     */
    keyless: boolean;
    /** Router or local server: accept model IDs not present in any list. */
    passthrough: boolean;
    models: Record<string, ModelsDev.Model>;
  }

  function seed(
    id: string,
    name: string,
    options: {
      context?: number;
      output?: number;
      reasoning?: boolean;
      attachment?: boolean;
      free?: boolean;
    } = {}
  ): ModelsDev.Model {
    const context = options.context ?? 128000;
    return {
      id,
      name,
      release_date: '',
      attachment: options.attachment ?? false,
      reasoning: options.reasoning ?? false,
      temperature: true,
      tool_call: true,
      cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
      limit: { context, output: options.output ?? Math.min(16384, context) },
      modalities: {
        input: options.attachment ? ['text', 'image'] : ['text'],
        output: ['text'],
      },
      options: {},
    };
  }

  const LOCAL = { context: 32768, output: 8192 };

  export const DEFINITIONS: Definition[] = [
    {
      id: 'gpt4free',
      name: 'GPT4Free (local Interference API)',
      api: 'http://localhost:1337/v1',
      baseURLEnv: ['G4F_BASE_URL', 'GPT4FREE_BASE_URL'],
      env: ['G4F_API_KEY'],
      doc: 'https://github.com/xtekky/gpt4free',
      keyless: true,
      passthrough: true,
      models: { auto: seed('auto', 'GPT4Free Auto (provider rotation)') },
    },
    {
      id: 'g4f-space',
      name: 'GPT4Free hosted gateway (g4f.space)',
      api: 'https://g4f.space/v1',
      baseURLEnv: ['G4F_SPACE_BASE_URL'],
      env: ['G4F_SPACE_API_KEY'],
      doc: 'https://g4f.dev/docs',
      keyless: true,
      passthrough: true,
      models: { auto: seed('auto', 'GPT4Free Auto (random public server)') },
    },
    {
      id: 'pollinations',
      name: 'Pollinations',
      api: 'https://gen.pollinations.ai/v1',
      baseURLEnv: ['POLLINATIONS_BASE_URL'],
      env: ['POLLINATIONS_API_KEY'],
      doc: 'https://pollinations.ai',
      keyless: true,
      passthrough: true,
      models: {
        openai: seed('openai', 'GPT-5.4 Nano (Pollinations alias)', {
          context: 400000,
          reasoning: true,
          attachment: true,
        }),
        'openai-fast': seed('openai-fast', 'GPT-5 Nano (Pollinations alias)', {
          context: 400000,
          reasoning: true,
          attachment: true,
        }),
        deepseek: seed('deepseek', 'DeepSeek V4 Flash (Pollinations alias)', {
          context: 1048576,
          reasoning: true,
        }),
        kimi: seed('kimi', 'Kimi K2.6 (Pollinations alias)', {
          context: 262000,
          reasoning: true,
        }),
        minimax: seed('minimax', 'MiniMax M3 (Pollinations alias)', {
          context: 524288,
          reasoning: true,
        }),
        nemotron: seed('nemotron', 'Nemotron 3 Ultra (Pollinations alias)', {
          context: 262144,
          reasoning: true,
        }),
      },
    },
    {
      id: 'airforce',
      name: 'Airforce',
      api: 'https://api.airforce/v1',
      env: ['AIRFORCE_API_KEY'],
      doc: 'https://api.airforce',
      keyless: false,
      passthrough: true,
      models: {},
    },
    {
      id: 'aibadgr',
      name: 'AI Badgr',
      api: 'https://aibadgr.com/api/v1',
      env: ['AIBADGR_API_KEY'],
      doc: 'https://aibadgr.com',
      keyless: false,
      passthrough: false,
      models: {},
    },
    {
      id: 'api-route',
      name: 'APIRoute',
      api: 'https://global.api-route.com/v1',
      env: ['APIROUTE_API_KEY', 'API_ROUTE_API_KEY'],
      doc: 'https://www.api-route.com',
      keyless: false,
      passthrough: true,
      models: {},
    },
    {
      id: 'cheaperinference',
      name: 'CheaperInference',
      api: 'https://api.cheaperinference.com/v1',
      env: ['CHEAPERINFERENCE_API_KEY'],
      doc: 'https://cheaperinference.com',
      keyless: false,
      passthrough: false,
      models: {},
    },
    {
      id: 'theb',
      name: 'TheB.AI',
      api: 'https://api.theb.ai/v1',
      env: ['THEB_API_KEY'],
      doc: 'https://theb.ai',
      keyless: false,
      passthrough: false,
      models: {},
    },
    {
      id: 'ollama',
      name: 'Ollama (local)',
      api: 'http://127.0.0.1:11434/v1',
      baseURLEnv: ['OLLAMA_BASE_URL', 'OLLAMA_HOST'],
      env: [],
      doc: 'https://ollama.com',
      keyless: true,
      passthrough: true,
      models: {},
    },
    {
      id: 'vllm',
      name: 'vLLM (local)',
      api: 'http://127.0.0.1:8000/v1',
      baseURLEnv: ['VLLM_BASE_URL'],
      env: ['VLLM_API_KEY'],
      doc: 'https://docs.vllm.ai',
      keyless: true,
      passthrough: true,
      models: {},
    },
    {
      id: 'llamacpp',
      name: 'llama.cpp server (local)',
      api: 'http://127.0.0.1:8080/v1',
      baseURLEnv: ['LLAMACPP_BASE_URL'],
      env: ['LLAMACPP_API_KEY'],
      doc: 'https://github.com/ggml-org/llama.cpp',
      keyless: true,
      passthrough: true,
      models: {},
    },
    {
      id: 'omniroute',
      name: 'OmniRoute (local)',
      api: 'http://localhost:20128/v1',
      baseURLEnv: ['OMNIROUTE_BASE_URL'],
      env: ['OMNIROUTE_API_KEY'],
      doc: 'https://github.com/xtekky/gpt4free',
      keyless: true,
      passthrough: true,
      models: {},
    },
  ];

  /** Alternative spellings accepted in `--model`. */
  export const ALIASES: Record<string, string> = {
    g4f: 'gpt4free',
    'gpt-4-free': 'gpt4free',
    'llama.cpp': 'llamacpp',
  };

  /** Catalogue entries we did not add but treat as local/keyless. */
  const EXTRA_KEYLESS = new Set(['lmstudio']);
  const EXTRA_PASSTHROUGH = new Set(['lmstudio']);

  /**
   * models.dev packages that do not load with the bundled AI SDK major
   * version, mapped to their OpenAI-compatible endpoint.
   */
  export const NPM_FALLBACKS: Record<string, { npm: string; api: string }> = {
    'venice-ai-sdk-provider': {
      npm: '@ai-sdk/openai-compatible',
      api: 'https://api.venice.ai/api/v1',
    },
    '@aihubmix/ai-sdk-provider': {
      npm: '@ai-sdk/openai-compatible',
      api: 'https://aihubmix.com/v1',
    },
  };

  const byID = new Map(DEFINITIONS.map((item) => [item.id, item]));

  export function canonicalID(providerID: string): string {
    return ALIASES[providerID] ?? providerID;
  }

  export function get(providerID: string): Definition | undefined {
    return byID.get(canonicalID(providerID));
  }

  export function isKeyless(providerID: string): boolean {
    const id = canonicalID(providerID);
    return Boolean(byID.get(id)?.keyless) || EXTRA_KEYLESS.has(id);
  }

  export function allowsUnknownModels(providerID: string): boolean {
    const id = canonicalID(providerID);
    return Boolean(byID.get(id)?.passthrough) || EXTRA_PASSTHROUGH.has(id);
  }

  function normalizeBaseURL(id: string, value: string): string {
    let url = value.trim().replace(/\/+$/, '');
    if (!/^[a-z]+:\/\//i.test(url)) url = `http://${url}`;
    // OLLAMA_HOST and similar point at the server root, not the API path.
    if (id === 'ollama' && !/\/v1$/.test(url)) url = `${url}/v1`;
    return url;
  }

  /**
   * Base URL for a definition. `G4F_PROVIDER` pins gpt4free to one of its
   * providers through the `/api/{provider}` route of the Interference API.
   */
  export function baseURL(
    definition: Definition,
    env: Record<string, string | undefined> = process.env
  ): string {
    const fromEnv = definition.baseURLEnv
      ?.map((name) => env[name])
      .find((value) => value && value.trim());
    let url = fromEnv
      ? normalizeBaseURL(definition.id, fromEnv)
      : definition.api;
    const pinned = env['G4F_PROVIDER']?.trim();
    if (
      pinned &&
      (definition.id === 'gpt4free' || definition.id === 'g4f-space')
    ) {
      url = `${url.replace(/\/v1$/, '')}/api/${encodeURIComponent(pinned)}`;
    }
    return url;
  }

  export function toProvider(
    definition: Definition,
    env: Record<string, string | undefined> = process.env
  ): ModelsDev.Provider {
    return {
      id: definition.id,
      name: definition.name,
      api: baseURL(definition, env),
      npm: '@ai-sdk/openai-compatible',
      env: definition.env,
      doc: definition.doc,
      models: structuredClone(definition.models),
    };
  }

  /**
   * Add the missing providers and patch catalogue entries the bundled SDKs
   * cannot load. Mutates and returns `database`.
   */
  export function augment(
    database: Record<string, ModelsDev.Provider>,
    env: Record<string, string | undefined> = process.env
  ): Record<string, ModelsDev.Provider> {
    for (const definition of DEFINITIONS) {
      if (database[definition.id]) continue;
      database[definition.id] = toProvider(definition, env);
    }

    for (const provider of Object.values(database)) {
      const fallback = provider.npm ? NPM_FALLBACKS[provider.npm] : undefined;
      if (!fallback) continue;
      provider.npm = fallback.npm;
      provider.api = provider.api ?? fallback.api;
    }

    const lmstudio = database['lmstudio'];
    const lmstudioURL = env['LMSTUDIO_BASE_URL']?.trim();
    if (lmstudio && lmstudioURL) {
      lmstudio.api = normalizeBaseURL('lmstudio', lmstudioURL);
    }
    return database;
  }
}
