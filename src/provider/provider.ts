import z from 'zod';
import path from 'path';
import { Config } from '../config/config';
import { mergeDeep, sortBy } from 'remeda';
import { NoSuchModelError, type LanguageModel, type Provider as SDK } from 'ai';
import { Log } from '../util/log';
import { BunProc } from '../bun';
import { ModelsDev } from './models';
import { NamedError } from '../util/error';
import { Auth } from '../auth';
import { ClaudeOAuth } from '../auth/claude-oauth';
import { AuthPlugins } from '../auth/plugins';
import { Instance } from '../project/instance';
import { Global } from '../global';
import { Flag } from '../flag/flag';
import { iife } from '../util/iife';

export namespace Provider {
  const log = Log.create({ service: 'provider' });

  type CustomLoader = (provider: ModelsDev.Provider) => Promise<{
    autoload: boolean;
    getModel?: (
      sdk: any,
      modelID: string,
      options?: Record<string, any>
    ) => Promise<any>;
    options?: Record<string, any>;
  }>;

  type Source = 'env' | 'config' | 'custom' | 'api';

  const CUSTOM_LOADERS: Record<string, CustomLoader> = {
    async anthropic(input) {
      // Check if OAuth credentials are available via the auth plugin
      const auth = await Auth.get('anthropic');
      if (auth?.type === 'oauth') {
        log.info('using anthropic oauth credentials');
        const loaderFn = await AuthPlugins.getLoader('anthropic');
        if (loaderFn) {
          const result = await loaderFn(() => Auth.get('anthropic'), input);
          if (result.fetch) {
            return {
              autoload: true,
              options: {
                apiKey: result.apiKey || '',
                fetch: result.fetch,
                headers: {
                  'anthropic-beta':
                    'oauth-2025-04-20,claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14',
                },
              },
            };
          }
        }
      }
      // Default: API key auth
      return {
        autoload: false,
        options: {
          headers: {
            'anthropic-beta':
              'claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14',
          },
        },
      };
    },
    async opencode(input) {
      const hasKey = await (async () => {
        if (input.env.some((item) => process.env[item])) return true;
        if (await Auth.get(input.id)) return true;
        return false;
      })();

      if (!hasKey) {
        for (const [key, value] of Object.entries(input.models)) {
          if (value.cost.input === 0) continue;
          delete input.models[key];
        }
      }

      return {
        autoload: Object.keys(input.models).length > 0,
        options: hasKey ? {} : { apiKey: 'public' },
      };
    },
    openai: async () => {
      return {
        autoload: false,
        async getModel(
          sdk: any,
          modelID: string,
          _options?: Record<string, any>
        ) {
          return sdk.responses(modelID);
        },
        options: {},
      };
    },
    azure: async () => {
      return {
        autoload: false,
        async getModel(
          sdk: any,
          modelID: string,
          options?: Record<string, any>
        ) {
          if (options?.['useCompletionUrls']) {
            return sdk.chat(modelID);
          } else {
            return sdk.responses(modelID);
          }
        },
        options: {},
      };
    },
    'azure-cognitive-services': async () => {
      const resourceName =
        process.env['AZURE_COGNITIVE_SERVICES_RESOURCE_NAME'];
      return {
        autoload: false,
        async getModel(
          sdk: any,
          modelID: string,
          options?: Record<string, any>
        ) {
          if (options?.['useCompletionUrls']) {
            return sdk.chat(modelID);
          } else {
            return sdk.responses(modelID);
          }
        },
        options: {
          baseURL: resourceName
            ? `https://${resourceName}.cognitiveservices.azure.com/openai`
            : undefined,
        },
      };
    },
    'amazon-bedrock': async () => {
      if (
        !process.env['AWS_PROFILE'] &&
        !process.env['AWS_ACCESS_KEY_ID'] &&
        !process.env['AWS_BEARER_TOKEN_BEDROCK']
      )
        return { autoload: false };

      const region = process.env['AWS_REGION'] ?? 'us-east-1';

      const { fromNodeProviderChain } = await import(
        await BunProc.install('@aws-sdk/credential-providers')
      );
      return {
        autoload: true,
        options: {
          region,
          credentialProvider: fromNodeProviderChain(),
        },
        async getModel(
          sdk: any,
          modelID: string,
          _options?: Record<string, any>
        ) {
          let regionPrefix = region.split('-')[0];

          switch (regionPrefix) {
            case 'us': {
              const modelRequiresPrefix = [
                'nova-micro',
                'nova-lite',
                'nova-pro',
                'nova-premier',
                'claude',
                'deepseek',
              ].some((m) => modelID.includes(m));
              const isGovCloud = region.startsWith('us-gov');
              if (modelRequiresPrefix && !isGovCloud) {
                modelID = `${regionPrefix}.${modelID}`;
              }
              break;
            }
            case 'eu': {
              const regionRequiresPrefix = [
                'eu-west-1',
                'eu-west-2',
                'eu-west-3',
                'eu-north-1',
                'eu-central-1',
                'eu-south-1',
                'eu-south-2',
              ].some((r) => region.includes(r));
              const modelRequiresPrefix = [
                'claude',
                'nova-lite',
                'nova-micro',
                'llama3',
                'pixtral',
              ].some((m) => modelID.includes(m));
              if (regionRequiresPrefix && modelRequiresPrefix) {
                modelID = `${regionPrefix}.${modelID}`;
              }
              break;
            }
            case 'ap': {
              const isAustraliaRegion = [
                'ap-southeast-2',
                'ap-southeast-4',
              ].includes(region);
              if (
                isAustraliaRegion &&
                ['anthropic.claude-sonnet-4-5', 'anthropic.claude-haiku'].some(
                  (m) => modelID.includes(m)
                )
              ) {
                regionPrefix = 'au';
                modelID = `${regionPrefix}.${modelID}`;
              } else {
                const modelRequiresPrefix = [
                  'claude',
                  'nova-lite',
                  'nova-micro',
                  'nova-pro',
                ].some((m) => modelID.includes(m));
                if (modelRequiresPrefix) {
                  regionPrefix = 'apac';
                  modelID = `${regionPrefix}.${modelID}`;
                }
              }
              break;
            }
          }

          return sdk.languageModel(modelID);
        },
      };
    },
    openrouter: async () => {
      return {
        autoload: false,
        options: {
          headers: {
            'HTTP-Referer': 'https://opencode.ai/',
            'X-Title': 'opencode',
          },
        },
      };
    },
    vercel: async () => {
      return {
        autoload: false,
        options: {
          headers: {
            'http-referer': 'https://opencode.ai/',
            'x-title': 'opencode',
          },
        },
      };
    },
    'google-vertex': async () => {
      const project =
        process.env['GOOGLE_CLOUD_PROJECT'] ??
        process.env['GCP_PROJECT'] ??
        process.env['GCLOUD_PROJECT'];
      const location =
        process.env['GOOGLE_CLOUD_LOCATION'] ??
        process.env['VERTEX_LOCATION'] ??
        'us-east5';
      const autoload = Boolean(project);
      if (!autoload) return { autoload: false };
      return {
        autoload: true,
        options: {
          project,
          location,
        },
        async getModel(sdk: any, modelID: string) {
          const id = String(modelID).trim();
          return sdk.languageModel(id);
        },
      };
    },
    'google-vertex-anthropic': async () => {
      const project =
        process.env['GOOGLE_CLOUD_PROJECT'] ??
        process.env['GCP_PROJECT'] ??
        process.env['GCLOUD_PROJECT'];
      const location =
        process.env['GOOGLE_CLOUD_LOCATION'] ??
        process.env['VERTEX_LOCATION'] ??
        'global';
      const autoload = Boolean(project);
      if (!autoload) return { autoload: false };
      return {
        autoload: true,
        options: {
          project,
          location,
        },
        async getModel(sdk: any, modelID: string) {
          const id = String(modelID).trim();
          return sdk.languageModel(id);
        },
      };
    },
    zenmux: async () => {
      return {
        autoload: false,
        options: {
          headers: {
            'HTTP-Referer': 'https://opencode.ai/',
            'X-Title': 'opencode',
          },
        },
      };
    },
    groq: async () => {
      return {
        autoload: false,
        options: {},
      };
    },
    /**
     * Google OAuth provider for Gemini subscription users
     * Uses OAuth credentials from agent auth login (Google AI Pro/Ultra)
     *
     * To authenticate, run: agent auth google
     */
    google: async (input) => {
      const auth = await Auth.get('google');
      if (auth?.type === 'oauth') {
        log.info('using google oauth credentials');
        const loaderFn = await AuthPlugins.getLoader('google');
        if (loaderFn) {
          const result = await loaderFn(() => Auth.get('google'), input);
          if (result.fetch) {
            return {
              autoload: true,
              options: {
                apiKey: result.apiKey || '',
                fetch: result.fetch,
              },
            };
          }
        }
      }
      // Default: API key auth (no OAuth credentials found)
      return { autoload: false };
    },
    /**
     * GitHub Copilot OAuth provider
     * Uses OAuth credentials from agent auth login
     */
    'github-copilot': async (input) => {
      const auth = await Auth.get('github-copilot');
      if (auth?.type === 'oauth') {
        log.info('using github copilot oauth credentials');
        const loaderFn = await AuthPlugins.getLoader('github-copilot');
        if (loaderFn) {
          const result = await loaderFn(
            () => Auth.get('github-copilot'),
            input
          );
          if (result.fetch) {
            return {
              autoload: true,
              options: {
                apiKey: result.apiKey || '',
                baseURL: result.baseURL,
                fetch: result.fetch,
              },
            };
          }
        }
      }
      return { autoload: false };
    },
    /**
     * GitHub Copilot Enterprise OAuth provider
     * Uses OAuth credentials from agent auth login with enterprise URL
     */
    'github-copilot-enterprise': async (input) => {
      const auth = await Auth.get('github-copilot-enterprise');
      if (auth?.type === 'oauth') {
        log.info('using github copilot enterprise oauth credentials');
        const loaderFn = await AuthPlugins.getLoader('github-copilot');
        if (loaderFn) {
          const result = await loaderFn(
            () => Auth.get('github-copilot-enterprise'),
            input
          );
          if (result.fetch) {
            return {
              autoload: true,
              options: {
                apiKey: result.apiKey || '',
                baseURL: result.baseURL,
                fetch: result.fetch,
              },
            };
          }
        }
      }
      return { autoload: false };
    },
    /**
     * Claude OAuth provider - uses Claude OAuth credentials to access
     * Anthropic models via the Claude API.
     *
     * This provider supports two methods:
     * 1. Environment variable: CLAUDE_CODE_OAUTH_TOKEN
     * 2. Credentials file: ~/.claude/.credentials.json (from Claude Code CLI or our auth command)
     *
     * OAuth tokens use Bearer authentication (Authorization header)
     * instead of x-api-key authentication used by standard API keys.
     *
     * To authenticate, run: agent auth claude
     */
    'claude-oauth': async (input) => {
      // Check for OAuth token from environment variable first
      let oauthToken = process.env['CLAUDE_CODE_OAUTH_TOKEN'];
      let tokenSource = 'environment';

      if (!oauthToken) {
        // Check for OAuth credentials from credentials file
        const claudeCreds = await ClaudeOAuth.getCredentials();
        if (claudeCreds) {
          oauthToken = claudeCreds.accessToken;
          tokenSource = `credentials file (${claudeCreds.subscriptionType ?? 'unknown'})`;
        }
      }

      if (!oauthToken) {
        return { autoload: false };
      }

      log.info('using claude oauth credentials', { source: tokenSource });

      // Create authenticated fetch with Bearer token and OAuth beta header
      const customFetch = ClaudeOAuth.createAuthenticatedFetch(oauthToken);

      return {
        autoload: true,
        options: {
          // Use a placeholder key to satisfy the SDK's API key requirement
          // The actual authentication is done via Bearer token in customFetch
          apiKey: 'oauth-token-placeholder',
          fetch: customFetch,
          headers: {
            'anthropic-beta':
              'oauth-2025-04-20,claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14',
          },
        },
      };
    },
  };

  const state = Instance.state(async () => {
    using _ = log.time('state');
    const config = await Config.get();
    const database = await ModelsDev.get();

    const providers: {
      [providerID: string]: {
        source: Source;
        info: ModelsDev.Provider;
        getModel?: (
          sdk: any,
          modelID: string,
          options?: Record<string, any>
        ) => Promise<any>;
        options: Record<string, any>;
      };
    } = {};
    const models = new Map<
      string,
      {
        providerID: string;
        modelID: string;
        info: ModelsDev.Model;
        language: LanguageModel;
        npm?: string;
      }
    >();
    const sdk = new Map<number, SDK>();
    // Maps `${provider}/${key}` to the provider’s actual model ID for custom aliases.
    const realIdByKey = new Map<string, string>();

    log.info('init');

    function mergeProvider(
      id: string,
      options: Record<string, any>,
      source: Source,
      getModel?: (
        sdk: any,
        modelID: string,
        options?: Record<string, any>
      ) => Promise<any>
    ) {
      const provider = providers[id];
      if (!provider) {
        const info = database[id];
        if (!info) return;
        if (info.api && !options['baseURL']) options['baseURL'] = info.api;
        providers[id] = {
          source,
          info,
          options,
          getModel,
        };
        return;
      }
      provider.options = mergeDeep(provider.options, options);
      provider.source = source;
      provider.getModel = getModel ?? provider.getModel;
    }

    const configProviders = Object.entries(config.provider ?? {});

    // Add GitHub Copilot Enterprise provider that inherits from GitHub Copilot
    if (database['github-copilot']) {
      const githubCopilot = database['github-copilot'];
      database['github-copilot-enterprise'] = {
        ...githubCopilot,
        id: 'github-copilot-enterprise',
        name: 'GitHub Copilot Enterprise',
        // Enterprise uses a different API endpoint - will be set dynamically based on auth
        api: undefined,
      };
    }

    // Add Claude OAuth provider that inherits from Anthropic
    // This allows using Claude Code CLI OAuth credentials with the Anthropic API
    if (database['anthropic']) {
      const anthropic = database['anthropic'];
      database['claude-oauth'] = {
        ...anthropic,
        id: 'claude-oauth',
        name: 'Claude OAuth',
        // Use CLAUDE_CODE_OAUTH_TOKEN environment variable
        env: ['CLAUDE_CODE_OAUTH_TOKEN'],
      };
    }

    // Add gemini-3-pro alias for google provider
    // The actual model in Google's API is gemini-3-pro-preview, but we add gemini-3-pro as an alias for convenience
    if (database['google']?.models['gemini-3-pro-preview']) {
      const gemini3ProPreview =
        database['google'].models['gemini-3-pro-preview'];
      database['google'].models['gemini-3-pro'] = {
        ...gemini3ProPreview,
        id: 'gemini-3-pro-preview',
        name: 'Gemini 3 Pro',
      };
      realIdByKey.set('google/gemini-3-pro', 'gemini-3-pro-preview');
    }

    for (const [providerID, provider] of configProviders) {
      const existing = database[providerID];
      const parsed: ModelsDev.Provider = {
        id: providerID,
        npm: provider.npm ?? existing?.npm,
        name: provider.name ?? existing?.name ?? providerID,
        env: provider.env ?? existing?.env ?? [],
        api: provider.api ?? existing?.api,
        models: existing?.models ?? {},
      };

      for (const [modelID, model] of Object.entries(provider.models ?? {})) {
        const existing = parsed.models[model.id ?? modelID];
        const name = iife(() => {
          if (model.name) return model.name;
          if (model.id && model.id !== modelID) return modelID;
          return existing?.name ?? modelID;
        });
        const parsedModel: ModelsDev.Model = {
          id: modelID,
          name,
          release_date: model.release_date ?? existing?.release_date,
          attachment: model.attachment ?? existing?.attachment ?? false,
          reasoning: model.reasoning ?? existing?.reasoning ?? false,
          temperature: model.temperature ?? existing?.temperature ?? false,
          tool_call: model.tool_call ?? existing?.tool_call ?? true,
          cost:
            !model.cost && !existing?.cost
              ? {
                  input: 0,
                  output: 0,
                  cache_read: 0,
                  cache_write: 0,
                }
              : {
                  cache_read: 0,
                  cache_write: 0,
                  ...existing?.cost,
                  ...model.cost,
                },
          options: {
            ...existing?.options,
            ...model.options,
          },
          limit: model.limit ??
            existing?.limit ?? {
              context: 0,
              output: 0,
            },
          modalities: model.modalities ??
            existing?.modalities ?? {
              input: ['text'],
              output: ['text'],
            },
          headers: model.headers,
          provider: model.provider ?? existing?.provider,
        };
        if (model.id && model.id !== modelID) {
          realIdByKey.set(`${providerID}/${modelID}`, model.id);
        }
        parsed.models[modelID] = parsedModel;
      }
      database[providerID] = parsed;
    }

    const disabled = await Config.get().then(
      (cfg) => new Set(cfg.disabled_providers ?? [])
    );
    // load env
    for (const [providerID, provider] of Object.entries(database)) {
      if (disabled.has(providerID)) continue;
      // Find the first truthy env var (supports multiple env var options like Google's
      // GOOGLE_GENERATIVE_AI_API_KEY and GEMINI_API_KEY)
      const apiKey = provider.env
        .map((item) => process.env[item])
        .find(Boolean);
      if (!apiKey) continue;
      // Always pass the API key - the provider SDK needs it for authentication
      mergeProvider(providerID, { apiKey }, 'env');
    }

    // load apikeys
    for (const [providerID, provider] of Object.entries(await Auth.all())) {
      if (disabled.has(providerID)) continue;
      if (provider.type === 'api') {
        mergeProvider(providerID, { apiKey: provider.key }, 'api');
      }
    }

    // load custom
    for (const [providerID, fn] of Object.entries(CUSTOM_LOADERS)) {
      if (disabled.has(providerID)) continue;
      const result = await fn(database[providerID]);
      if (result && (result.autoload || providers[providerID])) {
        mergeProvider(
          providerID,
          result.options ?? {},
          'custom',
          result.getModel
        );
      }
    }

    // load config
    for (const [providerID, provider] of configProviders) {
      mergeProvider(providerID, provider.options ?? {}, 'config');
    }

    for (const [providerID, provider] of Object.entries(providers)) {
      const filteredModels = Object.fromEntries(
        Object.entries(provider.info.models)
          // Filter out blacklisted models
          .filter(
            ([modelID]) =>
              modelID !== 'gpt-5-chat-latest' &&
              !(providerID === 'openrouter' && modelID === 'openai/gpt-5-chat')
          )
          // Filter out experimental models
          .filter(
            ([, model]) =>
              ((!model.experimental && model.status !== 'alpha') ||
                Flag.OPENCODE_ENABLE_EXPERIMENTAL_MODELS) &&
              model.status !== 'deprecated'
          )
      );
      provider.info.models = filteredModels;

      if (Object.keys(provider.info.models).length === 0) {
        delete providers[providerID];
        continue;
      }
      log.info('found', { providerID });
    }

    return {
      models,
      providers,
      sdk,
      realIdByKey,
    };
  });

  export async function list() {
    return state().then((state) => state.providers);
  }

  async function getSDK(provider: ModelsDev.Provider, model: ModelsDev.Model) {
    return (async () => {
      using _ = log.time('getSDK', {
        providerID: provider.id,
      });
      const s = await state();
      const pkg = model.provider?.npm ?? provider.npm ?? provider.id;
      const options = { ...s.providers[provider.id]?.options };
      if (
        pkg.includes('@ai-sdk/openai-compatible') &&
        options['includeUsage'] === undefined
      ) {
        options['includeUsage'] = true;
      }
      const key = Bun.hash.xxHash32(JSON.stringify({ pkg, options }));
      const existing = s.sdk.get(key);
      if (existing) return existing;

      let installedPath: string;
      if (!pkg.startsWith('file://')) {
        log.info('installing provider package', {
          providerID: provider.id,
          pkg,
          version: 'latest',
        });
        installedPath = await BunProc.install(pkg, 'latest');
        log.info('provider package installed successfully', {
          providerID: provider.id,
          pkg,
          installedPath,
        });
      } else {
        log.info('loading local provider', { pkg });
        installedPath = pkg;
      }

      // The `google-vertex-anthropic` provider points to the `@ai-sdk/google-vertex` package.
      // Ref: https://github.com/sst/models.dev/blob/0a87de42ab177bebad0620a889e2eb2b4a5dd4ab/providers/google-vertex-anthropic/provider.toml
      // However, the actual export is at the subpath `@ai-sdk/google-vertex/anthropic`.
      // Ref: https://ai-sdk.dev/providers/ai-sdk-providers/google-vertex#google-vertex-anthropic-provider-usage
      // In addition, Bun's dynamic import logic does not support subpath imports,
      // so we patch the import path to load directly from `dist`.
      const modPath =
        provider.id === 'google-vertex-anthropic'
          ? `${installedPath}/dist/anthropic/index.mjs`
          : installedPath;
      const mod = await import(modPath);
      if (options['timeout'] !== undefined && options['timeout'] !== null) {
        // Preserve custom fetch if it exists, wrap it with timeout logic
        const customFetch = options['fetch'];
        options['fetch'] = async (input: any, init?: BunFetchRequestInit) => {
          const { signal, ...rest } = init ?? {};

          const signals: AbortSignal[] = [];
          if (signal) signals.push(signal);
          if (options['timeout'] !== false)
            signals.push(AbortSignal.timeout(options['timeout']));

          const combined =
            signals.length > 1 ? AbortSignal.any(signals) : signals[0];

          const fetchFn = customFetch ?? fetch;
          return fetchFn(input, {
            ...rest,
            signal: combined,
            // @ts-ignore see here: https://github.com/oven-sh/bun/issues/16682
            timeout: false,
          });
        };
      }
      const fn = mod[Object.keys(mod).find((key) => key.startsWith('create'))!];
      const loaded = fn({
        name: provider.id,
        ...options,
      });
      s.sdk.set(key, loaded);
      return loaded as SDK;
    })().catch((e) => {
      log.error('provider initialization failed', {
        providerID: provider.id,
        pkg: model.provider?.npm ?? provider.npm ?? provider.id,
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
        cause: e instanceof Error && e.cause ? String(e.cause) : undefined,
      });
      throw new InitError({ providerID: provider.id }, { cause: e });
    });
  }

  export async function getProvider(providerID: string) {
    return state().then((s) => s.providers[providerID]);
  }

  export async function getModel(providerID: string, modelID: string) {
    const key = `${providerID}/${modelID}`;
    const s = await state();
    if (s.models.has(key)) return s.models.get(key)!;

    log.info('getModel', {
      providerID,
      modelID,
    });

    const provider = s.providers[providerID];
    if (!provider) throw new ModelNotFoundError({ providerID, modelID });
    const info = provider.info.models[modelID];
    if (!info) throw new ModelNotFoundError({ providerID, modelID });
    const sdk = await getSDK(provider.info, info);

    try {
      const keyReal = `${providerID}/${modelID}`;
      const realID = s.realIdByKey.get(keyReal) ?? info.id;
      const language = provider.getModel
        ? await provider.getModel(sdk, realID, provider.options)
        : sdk.languageModel(realID);
      log.info('found', { providerID, modelID });
      s.models.set(key, {
        providerID,
        modelID,
        info,
        language,
        npm: info.provider?.npm ?? provider.info.npm,
      });
      return {
        modelID,
        providerID,
        info,
        language,
        npm: info.provider?.npm ?? provider.info.npm,
      };
    } catch (e) {
      if (e instanceof NoSuchModelError)
        throw new ModelNotFoundError(
          {
            modelID: modelID,
            providerID,
          },
          { cause: e }
        );
      throw e;
    }
  }

  export async function getSmallModel(providerID: string) {
    const cfg = await Config.get();

    if (cfg.small_model) {
      const parsed = parseModel(cfg.small_model);
      return getModel(parsed.providerID, parsed.modelID);
    }

    const provider = await state().then((state) => state.providers[providerID]);
    if (!provider) return;
    let priority = [
      'claude-haiku-4-5',
      'claude-haiku-4.5',
      '3-5-haiku',
      '3.5-haiku',
      'gemini-2.5-flash',
      'gpt-5-nano',
    ];
    // claude-haiku-4.5 is considered a premium model in github copilot, we shouldn't use premium requests for title gen
    if (providerID === 'github-copilot') {
      priority = priority.filter((m) => m !== 'claude-haiku-4.5');
    }
    if (providerID === 'opencode' || providerID === 'local') {
      priority = ['gpt-5-nano'];
    }
    for (const item of priority) {
      for (const model of Object.keys(provider.info.models)) {
        if (model.includes(item)) return getModel(providerID, model);
      }
    }
  }

  const priority = [
    'grok-code',
    'gpt-5',
    'claude-sonnet-4',
    'big-pickle',
    'gemini-3-pro',
  ];
  export function sort(models: ModelsDev.Model[]) {
    return sortBy(
      models,
      [
        (model) => priority.findIndex((filter) => model.id.includes(filter)),
        'desc',
      ],
      [(model) => (model.id.includes('latest') ? 0 : 1), 'asc'],
      [(model) => model.id, 'desc']
    );
  }

  export async function defaultModel() {
    const cfg = await Config.get();
    if (cfg.model) return parseModel(cfg.model);

    // Prefer opencode provider if available
    const providers = await list().then((val) => Object.values(val));
    const opencodeProvider = providers.find((p) => p.info.id === 'opencode');
    if (opencodeProvider) {
      const [model] = sort(Object.values(opencodeProvider.info.models));
      if (model) {
        return {
          providerID: opencodeProvider.info.id,
          modelID: model.id,
        };
      }
    }

    // Fall back to any available provider
    const provider = providers.find(
      (p) => !cfg.provider || Object.keys(cfg.provider).includes(p.info.id)
    );
    if (!provider) throw new Error('no providers found');
    const [model] = sort(Object.values(provider.info.models));
    if (!model) throw new Error('no models found');
    return {
      providerID: provider.info.id,
      modelID: model.id,
    };
  }

  export function parseModel(model: string) {
    const [providerID, ...rest] = model.split('/');
    return {
      providerID: providerID,
      modelID: rest.join('/'),
    };
  }

  export const ModelNotFoundError = NamedError.create(
    'ProviderModelNotFoundError',
    z.object({
      providerID: z.string(),
      modelID: z.string(),
    })
  );

  export const InitError = NamedError.create(
    'ProviderInitError',
    z.object({
      providerID: z.string(),
    })
  );
}
