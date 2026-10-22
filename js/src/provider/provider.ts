import z from 'zod';
import path from 'path';
import { Config } from '../config/file-config';
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
import { config, isVerbose } from '../config/config';
import { getDefaultModel, getDefaultModelParts } from '../config/defaults';
import { iife } from '../util/iife';
import { createEchoModel } from './echo';
import { createCacheModel } from './cache';
import { RetryFetch } from './retry-fetch';
import { SSEUsageExtractor } from '../util/sse-usage-extractor';
import { OpenCodeZen } from './opencode-zen';
import { Kilo } from './kilo';
import { EnvTemplate } from './env-template';
import { ExtraProviders } from './extra-providers';
import { ModelDiscovery } from './model-discovery';
import { ParityLoaders } from './parity-loaders';

// Direct imports for bundled providers - these are pre-installed to avoid runtime installation hangs
// @see https://github.com/link-assistant/agent/issues/173
// @see https://github.com/oven-sh/bun/issues/5831 (bun install hangs sporadically)
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createBedrockMantle } from '@ai-sdk/amazon-bedrock/mantle';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';
import { createVertexAnthropic } from '@ai-sdk/google-vertex/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createXai } from '@ai-sdk/xai';
import { createMistral } from '@ai-sdk/mistral';
import { createGroq } from '@ai-sdk/groq';
import { createAlibaba } from '@ai-sdk/alibaba';
import { createCerebras } from '@ai-sdk/cerebras';
import { createCohere } from '@ai-sdk/cohere';
import { createDeepInfra } from '@ai-sdk/deepinfra';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createFireworks } from '@ai-sdk/fireworks';
import { createGateway } from '@ai-sdk/gateway';
import { createPerplexity } from '@ai-sdk/perplexity';
import { createTogetherAI } from '@ai-sdk/togetherai';

export namespace Provider {
  const log = Log.create({ service: 'provider' });
  /**
   * Catalog lookups — which providers are installed, which provider a short
   * model name would map to — describe candidates, not the model a run uses.
   * They are logged under their own service and never carry `providerID` /
   * `modelID` fields, which stream consumers read as the run's model identity
   * (#313). The active model is attested by the `model_resolved` event.
   */
  const registryLog = Log.create({ service: 'provider-registry' });

  /**
   * Bundled providers - these are pre-installed and imported statically
   * to avoid runtime package installation which can hang or timeout.
   *
   * When a provider's npm package is in this map, we use the pre-installed
   * version instead of dynamically installing via `bun add`.
   *
   * @see https://github.com/link-assistant/agent/issues/173
   * @see https://github.com/Kilo-Org/kilo (reference implementation)
   */
  const BUNDLED_PROVIDERS: Record<string, (options: any) => SDK> = {
    '@ai-sdk/amazon-bedrock': createAmazonBedrock,
    '@ai-sdk/anthropic': createAnthropic,
    '@ai-sdk/azure': createAzure,
    '@ai-sdk/google': createGoogleGenerativeAI,
    '@ai-sdk/google-vertex': createVertex,
    '@ai-sdk/openai': createOpenAI,
    '@ai-sdk/openai-compatible': createOpenAICompatible,
    '@openrouter/ai-sdk-provider': createOpenRouter,
    '@ai-sdk/xai': createXai,
    '@ai-sdk/mistral': createMistral,
    '@ai-sdk/groq': createGroq,
    // Packages models.dev (and OpenCode) use for the remaining providers and
    // per-model overrides (#334).
    '@ai-sdk/amazon-bedrock/mantle': createBedrockMantle,
    '@ai-sdk/google-vertex/anthropic': createVertexAnthropic,
    '@ai-sdk/alibaba': createAlibaba,
    '@ai-sdk/cerebras': createCerebras,
    '@ai-sdk/cohere': createCohere,
    '@ai-sdk/deepinfra': createDeepInfra,
    '@ai-sdk/deepseek': createDeepSeek,
    '@ai-sdk/fireworks': createFireworks,
    '@ai-sdk/gateway': createGateway,
    '@ai-sdk/perplexity': createPerplexity,
    '@ai-sdk/togetherai': createTogetherAI,
  };

  type CustomLoader = (
    provider: ModelsDev.Provider
  ) => Promise<ParityLoaders.LoaderResult>;

  type Source = 'env' | 'config' | 'custom' | 'api';

  const FORMAL_AI_DEFAULT_BASE_URL = 'http://127.0.0.1:8080/api/openai/v1';
  const FORMAL_AI_API_KEY_ENV = 'FORMAL_AI_API_KEY';
  const FORMAL_AI_BASE_URL_ENV = 'FORMAL_AI_BASE_URL';
  const FORMAL_AI_DEFAULT_API_KEY = 'formal-ai';

  function getFormalAiBaseURL(provider?: ModelsDev.Provider) {
    return (
      process.env[FORMAL_AI_BASE_URL_ENV] ??
      provider?.api ??
      FORMAL_AI_DEFAULT_BASE_URL
    );
  }

  function createFormalAiLoader(input?: ModelsDev.Provider) {
    return {
      autoload: true,
      options: {
        apiKey: process.env[FORMAL_AI_API_KEY_ENV] ?? FORMAL_AI_DEFAULT_API_KEY,
        baseURL: getFormalAiBaseURL(input),
      },
    };
  }

  function createFormalAiModel(name = 'Formal AI'): ModelsDev.Model {
    return {
      id: 'formal-ai',
      name,
      release_date: '2026-07-03',
      attachment: false,
      reasoning: true,
      temperature: true,
      tool_call: true,
      cost: {
        input: 0,
        output: 0,
        cache_read: 0,
        cache_write: 0,
      },
      limit: {
        context: 60000,
        output: 8192,
      },
      modalities: {
        input: ['text'],
        output: ['text'],
      },
      options: {},
      provider: {
        npm: '@ai-sdk/openai-compatible',
      },
    };
  }

  function createFormalAiProvider(
    id: string,
    name: string
  ): ModelsDev.Provider {
    return {
      id,
      name,
      npm: '@ai-sdk/openai-compatible',
      api: getFormalAiBaseURL(),
      env: [FORMAL_AI_API_KEY_ENV],
      models: {
        'formal-ai': createFormalAiModel('formal-ai'),
      },
    };
  }

  const CUSTOM_LOADERS: Record<string, CustomLoader> = {
    'formal-ai': async (input) => createFormalAiLoader(input),
    formalai: async (input) => createFormalAiLoader(input),
    '@link-assistant': async (input) => createFormalAiLoader(input),
    async anthropic(input) {
      // Check if OAuth credentials are available via the auth plugin
      const auth = await Auth.get('anthropic');
      if (auth?.type === 'oauth') {
        log.info(() => ({ message: 'using anthropic oauth credentials' }));
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
     * Kilo provider - access to AI models through Kilo Gateway
     * Uses OpenRouter-compatible API at https://api.kilo.ai/api/openrouter
     *
     * Authentication recommended: run `agent auth login` and select "Kilo Gateway"
     * For API key authentication, set KILO_API_KEY environment variable
     *
     * Free Nemotron models are listed in Kilo.FREE_MODELS.
     *
     * @see https://kilo.ai/docs/gateway
     * @see https://kilo.ai/docs/advanced-usage/free-and-budget-models
     * @see https://github.com/Kilo-Org/kilo/tree/main/packages/kilo-gateway
     */
    kilo: async (input) => {
      const hasKey = await (async () => {
        if (input.env.some((item) => process.env[item])) return true;
        if (await Auth.get(input.id)) return true;
        return false;
      })();

      // Filter to only free models when no API key
      if (!hasKey) {
        for (const [key, value] of Object.entries(input.models)) {
          // Keep only free models (cost.input === 0) when no API key
          if (value.cost.input === 0) continue;
          delete input.models[key];
        }
      }

      // Build options
      const options: Record<string, any> = {};

      // Kilo-specific headers for the OpenRouter-compatible API
      // @see https://github.com/Kilo-Org/kilo/blob/main/packages/kilo-gateway/src/headers.ts
      const headers: Record<string, string> = {
        'User-Agent': 'opencode-kilo-provider',
        'X-KILOCODE-EDITORNAME': 'link-assistant-agent',
      };

      // Pass KILO_ORG_ID if available
      if (process.env['KILO_ORG_ID']) {
        headers['X-KILOCODE-ORGANIZATIONID'] = process.env['KILO_ORG_ID'];
      }

      options.headers = headers;

      // Use auth token if available (from `agent auth login` -> Kilo device auth)
      if (!hasKey) {
        // Without authentication, use 'anonymous' key
        // Note: The Kilo API may reject anonymous requests for completions.
        // Users should authenticate via `agent auth login` for reliable access.
        options.apiKey = 'anonymous';
      } else {
        // If we have stored auth, the loader will provide the token
        const auth = await Auth.get(input.id);
        if (auth) {
          if (auth.type === 'api') {
            options.apiKey = auth.key;
          } else if (auth.type === 'oauth') {
            options.apiKey = auth.access;
          }
        }
      }

      return {
        autoload: Object.keys(input.models).length > 0,
        options,
      };
    },
    /**
     * Qwen Coder OAuth provider for Qwen subscription users
     * Uses OAuth credentials from agent auth login (Qwen Coder Subscription)
     *
     * To authenticate, run: agent auth login (select Qwen Coder)
     */
    'qwen-coder': async (input) => {
      const auth = await Auth.get('qwen-coder');
      if (auth?.type === 'oauth') {
        log.info(() => ({
          message: 'using qwen-coder oauth credentials',
        }));
        const loaderFn = await AuthPlugins.getLoader('qwen-coder');
        if (loaderFn) {
          const result = await loaderFn(() => Auth.get('qwen-coder'), input);
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
      // Default: not auto-loaded without OAuth
      return { autoload: false };
    },
    /**
     * Alibaba OAuth provider (alias for Qwen Coder)
     * Uses OAuth credentials from agent auth login (Alibaba / Qwen Coder Subscription)
     *
     * To authenticate, run: agent auth login (select Alibaba)
     */
    alibaba: async (input) => {
      const auth = await Auth.get('alibaba');
      if (auth?.type === 'oauth') {
        log.info(() => ({
          message: 'using alibaba oauth credentials',
        }));
        const loaderFn = await AuthPlugins.getLoader('alibaba');
        if (loaderFn) {
          const result = await loaderFn(() => Auth.get('alibaba'), input);
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
      // Default: not auto-loaded without OAuth
      return { autoload: false };
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
        log.info(() => ({ message: 'using google oauth credentials' }));
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
        log.info(() => ({
          message: 'using github copilot oauth credentials',
        }));
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
        log.info(() => ({
          message: 'using github copilot enterprise oauth credentials',
        }));
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

      log.info(() => ({
        message: 'using claude oauth credentials',
        source: tokenSource,
      }));

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
    /**
     * Echo provider - synthetic provider for dry-run testing
     * Echoes back the user's input without making actual API calls.
     *
     * This provider is automatically enabled when --dry-run mode is active.
     * It can also be used explicitly with: --model link-assistant/echo
     *
     * @see https://github.com/link-assistant/agent/issues/89
     */
    'link-assistant': async () => {
      // Echo provider is always available - no external dependencies needed
      return {
        autoload: true, // Also available through --model link-assistant/echo
        async getModel(_sdk: any, modelID: string) {
          // Return our custom AI SDK language model.
          return createEchoModel(modelID);
        },
        options: {},
      };
    },
    /**
     * Cache provider - synthetic provider for caching API responses
     * Caches responses using links notation for deterministic testing.
     *
     * This provider caches API responses and falls back to echo behavior.
     * It can be used explicitly with: --model link-assistant/cache/opencode/grok-code
     *
     * @see https://github.com/link-assistant/agent/issues/89
     */
    'link-assistant/cache': async () => {
      // Cache provider is always available - no external dependencies needed
      return {
        autoload: false, // Not auto-loaded
        async getModel(_sdk: any, modelID: string) {
          // modelID should be in format "provider/model" like "opencode/grok-code"
          const parts = modelID.split('/');
          if (parts.length < 2) {
            throw new Error(
              `Invalid cache model ID: ${modelID}. Expected format: provider/model`
            );
          }
          const [providerId, ...modelParts] = parts;
          const actualModelId = modelParts.join('/');

          // Return our custom AI SDK language model.
          return createCacheModel(providerId, actualModelId);
        },
        options: {},
      };
    },
    // OpenCode parity: Cloudflare, Snowflake, SAP AI Core, Vertex, Bedrock,
    // attribution headers (#334).
    ...ParityLoaders.create(),
  };

  export const state = Instance.state(async () => {
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
        sdkOptions?: ParityLoaders.LoaderResult['sdkOptions'];
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

    log.info(() => ({ message: 'init' }));

    function mergeProvider(
      id: string,
      options: Record<string, any>,
      source: Source,
      getModel?: (
        sdk: any,
        modelID: string,
        options?: Record<string, any>
      ) => Promise<any>,
      sdkOptions?: ParityLoaders.LoaderResult['sdkOptions']
    ) {
      const provider = providers[id];
      if (!provider) {
        const info = database[id];
        if (!info) return;
        // models.dev base URLs may contain `${ENV}` placeholders (#334).
        const baseURL = EnvTemplate.resolve(info.api);
        if (baseURL && !options['baseURL']) options['baseURL'] = baseURL;
        providers[id] = {
          source,
          info,
          options,
          getModel,
          sdkOptions,
        };
        return;
      }
      provider.options = mergeDeep(provider.options, options);
      provider.source = source;
      provider.getModel = getModel ?? provider.getModel;
      provider.sdkOptions = sdkOptions ?? provider.sdkOptions;
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

    // Add Formal AI local OpenAI-compatible provider and selectors.
    // Formal AI serves the canonical model ID "formal-ai"; Agent also accepts
    // the scoped selector "@link-assistant/formal-ai" as a provider alias.
    database['formal-ai'] = createFormalAiProvider(
      'formal-ai',
      'Formal AI Local Server'
    );
    database['formalai'] = createFormalAiProvider(
      'formalai',
      'Formal AI Local Server'
    );
    database['@link-assistant'] = createFormalAiProvider(
      '@link-assistant',
      'Formal AI Local Server (@link-assistant alias)'
    );

    // Add link-assistant echo provider for dry-run testing
    // This synthetic provider echoes back user input without API calls
    // @see https://github.com/link-assistant/agent/issues/89
    database['link-assistant'] = {
      id: 'link-assistant',
      name: 'Link Assistant (Echo)',
      env: [], // No environment variables needed - synthetic provider
      models: {
        echo: {
          id: 'echo',
          name: 'Echo Model',
          release_date: '2024-01-01',
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          cost: {
            input: 0,
            output: 0,
            cache_read: 0,
            cache_write: 0,
          },
          limit: {
            context: 1000000, // Virtually unlimited
            output: 100000,
          },
          modalities: {
            input: ['text'],
            output: ['text'],
          },
          options: {},
        },
      },
    };

    // Add link-assistant/cache provider for caching API responses
    // This synthetic provider caches responses and falls back to echo
    // @see https://github.com/link-assistant/agent/issues/89
    database['link-assistant/cache'] = {
      id: 'link-assistant/cache',
      name: 'Link Assistant (Cache)',
      env: [], // No environment variables needed - synthetic provider
      models: {}, // Models are dynamically created based on the provider/model syntax
    };

    // Remove withdrawn Zen entries even when models.dev has a stale cache.
    // Operator model overrides are applied below and remain authoritative.
    if (database.opencode) {
      for (const id of OpenCodeZen.DEPRECATED_FREE_MODEL_IDS) {
        delete database.opencode.models[id];
      }
      for (const id of Object.keys(OpenCodeZen.FREE_MODEL_OVERRIDES)) {
        database.opencode.models[id] = OpenCodeZen.freeModelInfo(id);
      }
    }

    // Kilo keeps its curated free aliases and gains the rest of its
    // models.dev catalogue (text models only), served through the same
    // OpenRouter-compatible endpoint (#334).
    database.kilo = {
      id: 'kilo',
      name: 'Kilo Gateway',
      npm: '@openrouter/ai-sdk-provider',
      api: 'https://api.kilo.ai/api/openrouter',
      env: ['KILO_API_KEY'],
      models: {
        ...Kilo.catalogueModels(database.kilo),
        ...structuredClone(Kilo.FREE_MODELS),
      },
    };

    // Providers models.dev does not list (gpt4free, Pollinations, local
    // servers) and packages the bundled AI SDK cannot load (#334).
    ExtraProviders.augment(database);
    ParityLoaders.patchCloudflareGateway(
      database,
      process.env,
      config.provider?.['cloudflare-ai-gateway']?.options?.['baseURL']
    );

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
          limit: iife(() => {
            const limit = model.limit ?? existing?.limit;
            if (!limit) return { context: 0, output: 0 };
            // `context: null` is the config spelling of "no context limit";
            // the arithmetic downstream keeps reading 0 as "no window to
            // check", and the capability itself travels in `unlimited` (#307).
            return {
              context: limit.context ?? 0,
              output: limit.output ?? existing?.limit?.output ?? 0,
            };
          }),
          unlimited:
            model.unlimited ??
            (model.limit && model.limit.context === null ? true : undefined) ??
            existing?.unlimited,
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
      // GOOGLE_GENERATIVE_AI_API_KEY and GEMINI_API_KEY). Variables that only
      // fill a templated URL or name an account/region are not keys (#334).
      const apiKey = EnvTemplate.credentialEnv(provider)
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
          result.getModel,
          result.sdkOptions
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
                config.enableExperimentalModels) &&
              model.status !== 'deprecated'
          )
      );
      provider.info.models = filteredModels;

      if (Object.keys(provider.info.models).length === 0) {
        delete providers[providerID];
        continue;
      }
    }
    registryLog.info(() => ({
      message: 'providers available',
      available: Object.keys(providers),
    }));

    /**
     * Enable a keyless provider (gpt4free, Pollinations, local servers) on
     * first explicit use. They stay out of `providers` until then, so they
     * never take part in default or short-name resolution (#334).
     */
    async function activate(providerID: string): Promise<boolean> {
      if (providers[providerID]) return true;
      if (disabled.has(providerID)) return false;
      if (!database[providerID] || !ExtraProviders.isKeyless(providerID)) {
        return false;
      }
      const loader = CUSTOM_LOADERS[providerID];
      const result = loader ? await loader(database[providerID]) : undefined;
      mergeProvider(
        providerID,
        result?.options ?? {},
        'custom',
        result?.getModel,
        result?.sdkOptions
      );
      registryLog.info(() => ({
        message: 'keyless provider enabled on explicit request',
        provider: providerID,
      }));
      return Boolean(providers[providerID]);
    }

    return {
      models,
      providers,
      sdk,
      realIdByKey,
      database,
      activate,
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
      const entry = s.providers[provider.id];
      let options: Record<string, any> = { ...entry?.options };
      // Per-model endpoint from models.dev (Vertex partner models, Bedrock
      // Mantle, Cloudflare passthrough routes). A user-set baseURL still wins
      // for models served by the provider's own package (#334).
      const providerURL = EnvTemplate.resolve(provider.api);
      const modelURL = EnvTemplate.resolve(model.provider?.api);
      const ownPackage = !model.provider?.npm || pkg === provider.npm;
      if (
        modelURL &&
        /^https?:\/\//.test(modelURL) &&
        (!ownPackage ||
          !options['baseURL'] ||
          options['baseURL'] === providerURL)
      ) {
        options['baseURL'] = modelURL;
      }
      const template = model.provider?.api ?? provider.api;
      if (
        !options['baseURL'] &&
        EnvTemplate.isTemplate(template) &&
        !EnvTemplate.resolve(template)
      ) {
        const missing = EnvTemplate.variables(template).filter(
          (name) => !EnvTemplate.resolve(`\${${name}}`)
        );
        throw new Error(
          `Provider "${provider.id}" needs ${missing.join(', ')} to build its base URL (${template}). ` +
            `Set the environment variable(s) or provider.${provider.id}.options.baseURL in the config.`
        );
      }
      if (entry?.sdkOptions) options = entry.sdkOptions(pkg, options);
      if (
        pkg.includes('@ai-sdk/openai-compatible') &&
        options['includeUsage'] === undefined
      ) {
        options['includeUsage'] = true;
      }
      const key = Bun.hash.xxHash32(JSON.stringify({ pkg, options }));
      const existing = s.sdk.get(key);
      if (existing) return existing;

      // Apply timeout wrapper to options if timeout is specified
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

      // Wrap fetch with retry logic for rate limit handling (HTTP 429)
      // This ensures the agent's time-based retry (7-week timeout) is respected
      // instead of the AI SDK's fixed retry count (3 attempts)
      // See: https://github.com/link-assistant/agent/issues/167
      const existingFetch = options['fetch'] ?? fetch;
      options['fetch'] = RetryFetch.wrap(existingFetch, {
        sessionID: provider.id,
      });

      // Verbose HTTP logging for provider API calls.
      // This provider-level wrapper logs HTTP requests/responses independently
      // of the global fetch monkey-patch. Both mechanisms are kept active to
      // maximize HTTP observability — the global patch may miss calls if the
      // AI SDK captures/resolves fetch references before it is installed,
      // while this wrapper is injected directly into the SDK's fetch option.
      // See: https://github.com/link-assistant/agent/issues/221
      // See: https://github.com/link-assistant/agent/issues/217
      // See: https://github.com/link-assistant/agent/issues/215
      {
        const innerFetch = options['fetch'];
        let verboseWrapperConfirmed = false;
        let httpCallCount = 0;

        log.info('provider SDK fetch chain configured', {
          providerID: provider.id,
          pkg,
          globalVerboseFetchInstalled:
            !!globalThis.__agentVerboseFetchInstalled,
          verboseAtCreation: isVerbose(),
        });

        options['fetch'] = async (
          input: RequestInfo | URL,
          init?: RequestInit
        ): Promise<Response> => {
          // Check verbose flag at call time — not at SDK creation time.
          // Uses isVerbose() with env var fallback for resilience against
          // flag state loss in subprocess/module-reload scenarios.
          // See: https://github.com/link-assistant/agent/issues/206
          // See: https://github.com/link-assistant/agent/issues/227
          // Even when verbose mode is off, intercept streaming responses
          // to extract usage tokens from raw SSE data. This is critical for
          // recovering usage when the AI SDK drops it from finish-step events.
          // @see https://github.com/link-assistant/agent/issues/249
          if (!isVerbose()) {
            const response = await innerFetch(input, init);
            const ct = response.headers.get('content-type') ?? '';
            const isSSE =
              ct.includes('event-stream') || ct.includes('octet-stream');
            if (isSSE && response.body) {
              const [sdkStream, usageStream] = response.body.tee();
              const sseReqId = SSEUsageExtractor.nextRequestId();
              (async () => {
                try {
                  const reader = usageStream.getReader();
                  const decoder = new TextDecoder();
                  let body = '';
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    body += decoder.decode(value, { stream: true });
                    if (body.length > 50000) break;
                  }
                  SSEUsageExtractor.processStreamForUsage(sseReqId, body);
                } catch {
                  // Never break the SDK stream
                }
              })();
              return new Response(sdkStream, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
              });
            }
            return response;
          }

          httpCallCount++;
          const callNum = httpCallCount;

          // Log a one-time confirmation that the verbose wrapper is active for this provider.
          // This diagnostic breadcrumb confirms the wrapper is in the fetch chain.
          // See: https://github.com/link-assistant/agent/issues/215
          // See: https://github.com/link-assistant/agent/issues/235
          if (!verboseWrapperConfirmed) {
            verboseWrapperConfirmed = true;
            log.debug('verbose HTTP logging active', {
              providerID: provider.id,
            });
          }

          const url =
            typeof input === 'string'
              ? input
              : input instanceof URL
                ? input.toString()
                : input.url;
          const method = init?.method ?? 'GET';

          // Wrap all verbose logging in try/catch so it never breaks the actual HTTP request.
          // If logging fails, the request must still proceed — logging is observability, not control flow.
          // See: https://github.com/link-assistant/agent/issues/215
          let sanitizedHeaders: Record<string, string> = {};
          let bodyPreview: string | undefined;
          try {
            // Sanitize headers - mask authorization values
            const rawHeaders = init?.headers;
            if (rawHeaders) {
              const entries =
                rawHeaders instanceof Headers
                  ? Array.from(rawHeaders.entries())
                  : Array.isArray(rawHeaders)
                    ? rawHeaders
                    : Object.entries(rawHeaders);
              for (const [key, value] of entries) {
                const lower = key.toLowerCase();
                if (
                  lower === 'authorization' ||
                  lower === 'x-api-key' ||
                  lower === 'api-key'
                ) {
                  sanitizedHeaders[key] =
                    typeof value === 'string' && value.length > 8
                      ? value.slice(0, 4) + '...' + value.slice(-4)
                      : '[REDACTED]';
                } else {
                  sanitizedHeaders[key] = String(value);
                }
              }
            }

            // Log request body preview (truncated)
            if (init?.body) {
              const bodyStr =
                typeof init.body === 'string'
                  ? init.body
                  : init.body instanceof ArrayBuffer ||
                      init.body instanceof Uint8Array
                    ? `[binary ${(init.body as ArrayBuffer).byteLength ?? (init.body as Uint8Array).length} bytes]`
                    : undefined;
              if (bodyStr && typeof bodyStr === 'string') {
                bodyPreview =
                  bodyStr.length > 200000
                    ? bodyStr.slice(0, 200000) +
                      `... [truncated, total ${bodyStr.length} chars]`
                    : bodyStr;
              }
            }
          } catch (prepError) {
            // If header/body processing fails, log the error but continue with the request
            log.warn('verbose logging: failed to prepare request details', {
              providerID: provider.id,
              error:
                prepError instanceof Error
                  ? prepError.message
                  : String(prepError),
            });
          }

          // Use direct (non-lazy) logging for HTTP request/response to ensure output
          // is not lost when piped through external process wrappers (e.g., solve.mjs).
          // The verbose check is already done above, so lazy evaluation is not needed here.
          // See: https://github.com/link-assistant/agent/issues/211
          log.info('HTTP request', {
            caller: `provider/${provider.id}`,
            providerID: provider.id,
            callNum,
            method,
            url,
            headers: sanitizedHeaders,
            bodyPreview,
          });

          const startMs = Date.now();
          try {
            // Pass Bun-specific verbose:true to get detailed connection debugging
            // (prints request/response headers to stderr on socket errors).
            // This is a no-op on non-Bun runtimes.
            // See: https://bun.sh/docs/api/fetch
            // See: https://github.com/link-assistant/agent/issues/215
            const verboseInit = { ...init, verbose: true } as RequestInit;
            const response = await innerFetch(input, verboseInit);
            const durationMs = Date.now() - startMs;

            // Use direct (non-lazy) logging to ensure HTTP response details are captured
            // See: https://github.com/link-assistant/agent/issues/211
            log.info('HTTP response', {
              caller: `provider/${provider.id}`,
              providerID: provider.id,
              callNum,
              method,
              url,
              status: response.status,
              statusText: response.statusText,
              durationMs,
              responseHeaders: Object.fromEntries(response.headers.entries()),
            });

            // Log response body for debugging provider failures
            // For streaming responses (SSE/event-stream), tee() the stream so the AI SDK
            // still receives the full stream while we asynchronously log a preview.
            // For non-streaming responses, buffer the body and reconstruct the Response.
            // See: https://github.com/link-assistant/agent/issues/204
            const responseBodyMaxChars = 200000;
            const contentType = response.headers.get('content-type') ?? '';
            const isStreaming =
              contentType.includes('event-stream') ||
              contentType.includes('octet-stream');

            if (response.body) {
              if (isStreaming) {
                // Tee the stream: one copy for AI SDK, one for logging
                const [sdkStream, logStream] = response.body.tee();

                // Consume log stream asynchronously (does not block SDK)
                // Also extract usage tokens from raw SSE data as fallback
                // for when the AI SDK drops usage from its finish-step event.
                // @see https://github.com/link-assistant/agent/issues/249
                const sseRequestId = SSEUsageExtractor.nextRequestId();
                (async () => {
                  try {
                    const reader = logStream.getReader();
                    const decoder = new TextDecoder();
                    let bodyPreview = '';
                    let truncated = false;
                    while (true) {
                      const { done, value } = await reader.read();
                      if (done) break;
                      if (!truncated) {
                        const chunk = decoder.decode(value, { stream: true });
                        bodyPreview += chunk;
                        if (bodyPreview.length > responseBodyMaxChars) {
                          bodyPreview = bodyPreview.slice(
                            0,
                            responseBodyMaxChars
                          );
                          truncated = true;
                        }
                      }
                    }
                    // Extract usage from raw SSE stream as AI SDK fallback
                    SSEUsageExtractor.processStreamForUsage(
                      sseRequestId,
                      bodyPreview
                    );
                    // Use direct (non-lazy) logging for stream body
                    // See: https://github.com/link-assistant/agent/issues/211
                    log.info('HTTP response body (stream)', {
                      caller: `provider/${provider.id}`,
                      providerID: provider.id,
                      callNum,
                      url,
                      sseRequestId,
                      bodyPreview: truncated
                        ? bodyPreview + `... [truncated]`
                        : bodyPreview,
                    });
                  } catch {
                    // Ignore logging errors — do not affect the SDK stream
                  }
                })();

                // Return response with the SDK's copy of the stream
                return new Response(sdkStream, {
                  status: response.status,
                  statusText: response.statusText,
                  headers: response.headers,
                });
              } else {
                // Non-streaming: buffer body, log it, reconstruct Response
                const bodyText = await response.text();
                const bodyPreview =
                  bodyText.length > responseBodyMaxChars
                    ? bodyText.slice(0, responseBodyMaxChars) +
                      `... [truncated, total ${bodyText.length} chars]`
                    : bodyText;
                // Use direct (non-lazy) logging for non-streaming body
                // See: https://github.com/link-assistant/agent/issues/211
                log.info('HTTP response body', {
                  caller: `provider/${provider.id}`,
                  providerID: provider.id,
                  callNum,
                  url,
                  bodyPreview,
                });
                return new Response(bodyText, {
                  status: response.status,
                  statusText: response.statusText,
                  headers: response.headers,
                });
              }
            }

            return response;
          } catch (error) {
            const durationMs = Date.now() - startMs;
            // Use direct (non-lazy) logging for error path
            // Include stack trace and error cause for better debugging of socket errors
            // See: https://github.com/link-assistant/agent/issues/211
            // See: https://github.com/link-assistant/agent/issues/215
            log.error('HTTP request failed', {
              caller: `provider/${provider.id}`,
              providerID: provider.id,
              callNum,
              method,
              url,
              durationMs,
              error:
                error instanceof Error
                  ? {
                      name: error.name,
                      message: error.message,
                      stack: error.stack,
                      cause:
                        error.cause instanceof Error
                          ? error.cause.message
                          : error.cause
                            ? String(error.cause)
                            : undefined,
                    }
                  : String(error),
            });
            throw error;
          }
        };
      }

      // Check if we have a bundled provider first - this avoids runtime package installation
      // which can hang or timeout due to known Bun issues
      // @see https://github.com/link-assistant/agent/issues/173
      // @see https://github.com/oven-sh/bun/issues/5831
      const bundledFn = BUNDLED_PROVIDERS[pkg];
      if (bundledFn) {
        log.info(() => ({
          message: 'using bundled provider (no installation needed)',
          providerID: provider.id,
          pkg,
        }));
        const loaded = bundledFn({
          name: provider.id,
          ...options,
        });
        s.sdk.set(key, loaded);
        return loaded as SDK;
      }

      // Fall back to dynamic installation for non-bundled providers
      let installedPath: string;
      if (!pkg.startsWith('file://')) {
        log.info(() => ({
          message: 'installing provider package (not bundled)',
          providerID: provider.id,
          pkg,
          version: 'latest',
        }));
        installedPath = await BunProc.install(pkg, 'latest');
        log.info(() => ({
          message: 'provider package installed successfully',
          providerID: provider.id,
          pkg,
          installedPath,
        }));
      } else {
        log.info(() => ({ message: 'loading local provider', pkg }));
        installedPath = pkg;
      }

      // `@ai-sdk/google-vertex/anthropic` and other subpath packages are
      // bundled above, so no dist path patching is needed here (#334).
      const mod = await import(installedPath);

      const fn = mod[Object.keys(mod).find((key) => key.startsWith('create'))!];
      const loaded = fn({
        name: provider.id,
        ...options,
      });
      s.sdk.set(key, loaded);
      return loaded as SDK;
    })().catch((e) => {
      log.error(() => ({
        message: 'provider initialization failed',
        providerID: provider.id,
        pkg: model.provider?.npm ?? provider.npm ?? provider.id,
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
        cause: e instanceof Error && e.cause ? String(e.cause) : undefined,
      }));
      throw new InitError({ providerID: provider.id }, { cause: e });
    });
  }

  export async function getProvider(providerID: string) {
    const s = await state();
    const id = ExtraProviders.canonicalID(providerID);
    if (!s.providers[id]) await s.activate(id);
    return s.providers[id];
  }

  /**
   * Whether a provider's catalog lists a model. Looks at that one provider
   * only and logs nothing (#313). Routers and local servers that accept any
   * model ID count as listing every model (#334).
   */
  export async function hasModel(providerID: string, modelID: string) {
    const s = await state();
    const provider = s.providers[ExtraProviders.canonicalID(providerID)];
    if (!provider) return false;
    if (provider.info.models[modelID]) return true;
    return ExtraProviders.allowsUnknownModels(provider.info.id);
  }

  /**
   * Look a model up in the provider's own model listing. OpenCode Zen keeps
   * its dedicated free-model lookup; every other provider with a token-free
   * listing endpoint goes through `ModelDiscovery` (#334).
   */
  async function getLiveModelInfo(
    providerID: string,
    modelID: string
  ): Promise<ModelsDev.Model | undefined> {
    if (providerID === 'opencode') {
      return OpenCodeZen.getLiveFreeModelInfo(modelID);
    }
    const s = await state();
    const provider = s.providers[providerID];
    if (!provider) return undefined;
    const options = provider.options ?? {};
    const result = await ModelDiscovery.discover({
      providerID,
      npm: provider.info.npm,
      baseURL: options['baseURL'] ?? EnvTemplate.resolve(provider.info.api),
      apiKey:
        typeof options['apiKey'] === 'string' ? options['apiKey'] : undefined,
      headers: options['headers'],
    });
    const found = ModelDiscovery.findModel(result.models, modelID);
    if (!found) return undefined;
    return ModelDiscovery.toModelInfo(found, {
      metadata: ModelDiscovery.catalogueMetadata(
        s.database,
        found.id,
        providerID
      ),
    });
  }

  /** Metadata for a model ID a router or local server accepts unlisted. */
  function passthroughModelInfo(modelID: string): ModelsDev.Model {
    return ModelDiscovery.toModelInfo({ id: modelID, free: true });
  }

  export async function refreshLiveModelInfo(
    providerID: string,
    modelID: string
  ) {
    providerID = ExtraProviders.canonicalID(providerID);
    const info = await getLiveModelInfo(providerID, modelID);
    if (!info) return undefined;

    const s = await state();
    const provider = s.providers[providerID];
    if (provider) {
      provider.info.models[modelID] = info;
      log.info(() => ({
        message: 'model found in provider live model endpoint',
        providerID,
        modelID,
      }));
    }
    return info;
  }

  export async function getModel(providerID: string, modelID: string) {
    providerID = ExtraProviders.canonicalID(providerID);
    const key = `${providerID}/${modelID}`;
    const s = await state();
    if (s.models.has(key)) return s.models.get(key)!;

    log.info(() => ({ message: 'getModel', providerID, modelID }));

    if (!s.providers[providerID]) await s.activate(providerID);
    const provider = s.providers[providerID];
    if (!provider) {
      // Check if this model ID might exist in another provider (e.g., OpenRouter)
      // This helps users who use formats like "z-ai/glm-4.7" instead of "openrouter/z-ai/glm-4.7"
      const fullModelKey = `${providerID}/${modelID}`;
      let suggestion: string | undefined;

      for (const [knownProviderID, knownProvider] of Object.entries(
        s.providers
      )) {
        if (knownProvider.info.models[fullModelKey]) {
          suggestion = `Did you mean: ${knownProviderID}/${fullModelKey}?`;
          break;
        }
      }

      throw new ModelNotFoundError({ providerID, modelID, suggestion });
    }

    // For synthetic providers (like link-assistant/echo and link-assistant/cache), skip SDK loading
    // These providers have a custom getModel function that creates the model directly
    const isSyntheticProvider =
      providerID === 'link-assistant' || providerID === 'link-assistant/cache';

    // Synthetic models still need metadata for context limits and accounting.
    let info =
      provider.info.models[modelID] ??
      (isSyntheticProvider
        ? {
            ...s.providers['link-assistant'].info.models.echo,
            id: modelID,
            name: modelID,
          }
        : undefined);
    if (!isSyntheticProvider && !info) {
      // Model not in provider's known list - try refreshing the cache first (#200)
      // This handles stale bundled data or expired cache (1-hour TTL)
      log.info(() => ({
        message: 'model not in catalog - refreshing models cache',
        providerID,
        modelID,
      }));
      try {
        await ModelsDev.refresh();
        const freshDB = await ModelsDev.get();
        const freshProvider = freshDB[providerID];
        if (
          freshProvider?.models[modelID] &&
          !(
            providerID === 'opencode' &&
            OpenCodeZen.DEPRECATED_FREE_MODEL_IDS.has(modelID)
          )
        ) {
          // Model found after refresh - update provider info and use it
          provider.info.models[modelID] = freshProvider.models[modelID];
          info = freshProvider.models[modelID];
          log.info(() => ({
            message: 'model found after cache refresh',
            providerID,
            modelID,
          }));
        }
      } catch (refreshError) {
        log.warn(() => ({
          message: 'cache refresh failed',
          error:
            refreshError instanceof Error
              ? refreshError.message
              : String(refreshError),
        }));
      }
    }

    if (!isSyntheticProvider && !info) {
      const liveInfo = await getLiveModelInfo(providerID, modelID);
      if (liveInfo) {
        provider.info.models[modelID] = liveInfo;
        info = liveInfo;
        log.info(() => ({
          message: 'model found in provider live model endpoint',
          providerID,
          modelID,
        }));
      }
    }

    if (
      !isSyntheticProvider &&
      !info &&
      ExtraProviders.allowsUnknownModels(providerID)
    ) {
      // Routers (gpt4free, Pollinations) and local servers accept model IDs
      // that are not listed anywhere; pass the ID through as-is (#334).
      info = passthroughModelInfo(modelID);
      provider.info.models[modelID] = info;
      log.info(() => ({
        message: 'passing unlisted model through to router/local server',
        providerID,
        modelID,
      }));
    }

    if (!isSyntheticProvider && !info) {
      // Model not found even after cache refresh.
      // Check if this is the default model — if so, create synthetic info and proceed (#239).
      // The models.dev API can lag behind the provider's actual model availability.
      // For user-specified models, fail with a clear error (#231) to prevent silent substitution.
      const { providerID: defaultProviderID, modelID: defaultModelID } =
        getDefaultModelParts();
      const isDefaultModel =
        providerID === defaultProviderID && modelID === defaultModelID;
      const availableInProvider = Object.keys(provider.info.models).slice(
        0,
        10
      );

      if (isDefaultModel) {
        // Default model not in models.dev catalog — create synthetic info and try anyway (#239)
        log.warn(() => ({
          message:
            'default model not in provider catalog — creating synthetic info to proceed',
          providerID,
          modelID,
          availableModels: availableInProvider,
        }));
        info = {
          id: modelID,
          name: modelID,
        } as typeof info;
      } else {
        log.error(() => ({
          message:
            'model not found in provider catalog after refresh — refusing to proceed',
          providerID,
          modelID,
          availableModels: availableInProvider,
          totalModels: Object.keys(provider.info.models).length,
        }));

        throw new ModelNotFoundError({
          providerID,
          modelID,
          suggestion:
            `Model "${modelID}" not found in provider "${providerID}" (checked ${Object.keys(provider.info.models).length} models). ` +
            `Available models include: ${availableInProvider.join(', ')}. ` +
            `Use --model ${providerID}/<model-id> with a valid model.`,
        });
      }
    }

    try {
      const keyReal = `${providerID}/${modelID}`;
      const realID = s.realIdByKey.get(keyReal) ?? (info ? info.id : modelID);

      let language: LanguageModel;
      if (isSyntheticProvider && provider.getModel) {
        // For synthetic providers, call getModel directly without SDK
        language = await provider.getModel(null, realID, provider.options);
      } else {
        // For regular providers, load the SDK first
        const sdk = await getSDK(provider.info, info!);
        // Models that need a specific API shape (Bedrock Mantle, models.dev
        // `provider.shape`) pick the SDK method themselves (#334).
        language =
          ParityLoaders.selectByShape(sdk, info!, realID) ??
          (provider.getModel
            ? await provider.getModel(sdk, realID, provider.options)
            : sdk.languageModel(realID));
      }
      log.info(() => ({ message: 'found', providerID, modelID }));
      s.models.set(key, {
        providerID,
        modelID,
        info,
        language,
        npm: isSyntheticProvider
          ? provider.info.npm
          : (info.provider?.npm ?? provider.info.npm),
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

  /**
   * Get a small/cheap model for auxiliary tasks like title generation and summarization.
   * This is NOT the primary model for user requests - it's used for background tasks.
   *
   * Note: Logs from this function may show a different model than what the user specified.
   * This is by design - we use cheaper models for auxiliary tasks to save tokens/costs.
   *
   * @see https://github.com/link-assistant/agent/issues/179
   */
  export async function getSmallModel(providerID: string) {
    const cfg = await Config.get();

    if (cfg.small_model) {
      const parsed = parseModel(cfg.small_model);
      log.info(() => ({
        message: 'using configured small_model for auxiliary task',
        modelID: parsed.modelID,
        providerID: parsed.providerID,
      }));
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
      priority = Object.keys(OpenCodeZen.FREE_MODEL_OVERRIDES);
    }
    if (providerID === 'kilo') {
      priority = Object.keys(Kilo.FREE_MODELS);
    }
    for (const item of priority) {
      for (const model of Object.keys(provider.info.models)) {
        if (model.includes(item)) {
          log.info(() => ({
            message: 'selected small model for auxiliary task',
            modelID: model,
            providerID,
            hint: 'This model is used for title/summary generation, not primary requests',
          }));
          return getModel(providerID, model);
        }
      }
    }
  }

  const priority = [
    'big-pickle',
    'gpt-5-nano',
    'nemotron-3.5-lightning-free',
    'nemotron-3-ultra-free',
    'nemotron-3-super-free',
    'gpt-5',
    'claude-sonnet-4',
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

    // In dry-run mode, use the echo provider by default
    // This allows testing round-trips and multi-turn conversations without API costs
    // @see https://github.com/link-assistant/agent/issues/89
    if (config.dryRun) {
      log.info('dry-run mode enabled, using echo provider as default');
      return {
        providerID: 'link-assistant',
        modelID: 'echo',
      };
    }

    if (cfg.model) return parseModel(cfg.model);

    const configuredDefaultModel = getDefaultModel();
    if (configuredDefaultModel) {
      log.info(() => ({
        message: 'using configured default model',
        model: configuredDefaultModel,
      }));
      return parseModel(configuredDefaultModel);
    }

    // Prefer opencode provider if available
    const providers = await list().then((val) => Object.values(val));
    const opencodeProvider = providers.find((p) => p.info.id === 'opencode');
    if (opencodeProvider) {
      const [model] = sort(Object.values(opencodeProvider.info.models));
      if (model) {
        log.info(() => ({
          message: 'using opencode provider as default',
          provider: opencodeProvider.info.id,
          model: model.id,
        }));
        return {
          providerID: opencodeProvider.info.id,
          modelID: model.id,
        };
      }
    }

    // Fall back to any available provider if opencode is not available
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
      providerID: ExtraProviders.canonicalID(providerID),
      modelID: rest.join('/'),
    };
  }

  /**
   * Resolve a short model name (without provider prefix) to the appropriate provider.
   * This function finds which provider should handle a model when no explicit provider is specified.
   *
   * Built-in Kilo free aliases prefer Kilo, including aliases also served by
   * Zen, whose free tier is restricted to OpenCode clients. Other short names
   * resolve against available provider catalogs.
   *
   * @param modelID - Short model name without provider prefix
   * @returns Provider ID that should handle this model, or undefined if not found
   */
  export async function resolveShortModelName(
    modelID: string
  ): Promise<{ providerID: string; modelID: string } | undefined> {
    const s = await state();

    if (Object.hasOwn(Kilo.FREE_MODELS, modelID)) {
      const kiloProvider = s.providers.kilo;
      if (kiloProvider?.info.models[modelID]) {
        return { providerID: 'kilo', modelID };
      }
    }

    if (modelID === 'formal-ai') {
      const formalAiProvider = s.providers['formal-ai'];
      if (formalAiProvider && formalAiProvider.info.models[modelID]) {
        registryLog.info(() => ({
          message: 'resolved short model name to formal-ai (canonical)',
          name: modelID,
          candidate: `formal-ai/${modelID}`,
        }));
        return { providerID: 'formal-ai', modelID };
      }
    }

    // Check if model exists in any provider
    const matchingProviders: string[] = [];
    for (const [providerID, provider] of Object.entries(s.providers)) {
      if (provider.info.models[modelID]) {
        matchingProviders.push(providerID);
      }
    }

    if (matchingProviders.length === 0) {
      return undefined;
    }

    if (matchingProviders.length === 1) {
      const providerID = matchingProviders[0];
      registryLog.info(() => ({
        message: 'resolved short model name (single match)',
        name: modelID,
        candidate: `${providerID}/${modelID}`,
      }));
      return { providerID, modelID };
    }

    // Multiple providers have this model - prefer OpenCode for shared free models
    // This follows the convention that opencode is the primary free provider
    if (matchingProviders.includes('opencode')) {
      registryLog.info(() => ({
        message: 'resolved short model name to opencode (multiple providers)',
        name: modelID,
        candidate: `opencode/${modelID}`,
        availableProviders: matchingProviders,
      }));
      return { providerID: 'opencode', modelID };
    }

    // Fallback to first matching provider
    const providerID = matchingProviders[0];
    registryLog.info(() => ({
      message: 'resolved short model name (fallback)',
      name: modelID,
      candidate: `${providerID}/${modelID}`,
      availableProviders: matchingProviders,
    }));
    return { providerID, modelID };
  }

  /**
   * Parse a model string that may or may not include a provider prefix.
   * If no provider is specified, attempts to resolve the short model name to the appropriate provider.
   *
   * IMPORTANT: If the model cannot be resolved, this function throws an error instead of
   * silently falling back to a default. This ensures the user gets their requested model
   * or a clear error explaining why it's not available.
   *
   * Examples:
   * - "kilo/nemotron-3-super-free" -> { providerID: "kilo", modelID: "nemotron-3-super-free" }
   * - "nemotron-3-super-free" -> { providerID: "kilo", modelID: "nemotron-3-super-free" } (resolved)
   * - "big-pickle" -> { providerID: "opencode", modelID: "big-pickle" } (resolved)
   * - "nonexistent-model" -> throws ModelNotFoundError
   *
   * @param model - Model string with or without provider prefix
   * @returns Parsed provider ID and model ID
   * @throws ModelNotFoundError if the model cannot be found in any provider
   * @see https://github.com/link-assistant/agent/issues/194
   */
  export async function parseModelWithResolution(
    model: string
  ): Promise<{ providerID: string; modelID: string }> {
    // Check if model includes a provider prefix
    if (model.includes('/')) {
      // Explicit provider specified - use it directly
      return parseModel(model);
    }

    // No provider prefix - try to resolve the short model name
    const resolved = await resolveShortModelName(model);
    if (resolved) {
      return resolved;
    }

    // Unable to resolve - fail with a clear error instead of silently falling back
    // This prevents the issue where user requests model X but gets model Y
    // See: https://github.com/link-assistant/agent/issues/194
    const s = await state();
    const availableModels: string[] = [];

    // Collect some available models to suggest
    for (const [providerID, provider] of Object.entries(s.providers)) {
      for (const modelID of Object.keys(provider.info.models).slice(0, 3)) {
        availableModels.push(`${providerID}/${modelID}`);
      }
      if (availableModels.length >= 6) break;
    }

    const suggestion =
      availableModels.length > 0
        ? `Model "${model}" not found in any provider. Available models include: ${availableModels.join(', ')}. Use --model provider/model-id format for explicit selection.`
        : `Model "${model}" not found. No providers are currently available. Check your API keys or authentication.`;

    log.error(() => ({
      message: 'model not found - refusing to silently fallback',
      requestedModel: model,
      availableModels,
    }));

    throw new ModelNotFoundError({
      providerID: 'unknown',
      modelID: model,
      suggestion,
    });
  }

  /**
   * Defines models that are available in multiple free providers.
   * When one provider hits rate limits, the system can try an alternative.
   *
   * Note: This is only used for models without explicit provider specification.
   * If user specifies "kilo/nemotron-3-super-free", no fallback will occur.
   */
  const SHARED_FREE_MODELS: Record<string, string[]> = {
    'nemotron-3.5-lightning-free': ['kilo', 'opencode'],
  };

  /**
   * Get alternative providers for a model when the primary provider fails (e.g., rate limited).
   * This function returns a list of alternative providers that offer the same model.
   *
   * Note: This only returns alternatives for models without explicit provider specification.
   * If the original request had an explicit provider (like "kilo/nemotron-3-super-free"), this returns empty array.
   *
   * @param modelID - The model ID to find alternatives for
   * @param failedProviderID - The provider that failed
   * @param wasExplicitProvider - Whether the user explicitly specified the provider
   * @returns Array of alternative provider IDs that can serve this model
   */
  export async function getAlternativeProviders(
    modelID: string,
    failedProviderID: string,
    wasExplicitProvider: boolean
  ): Promise<string[]> {
    // If the user explicitly specified a provider, don't offer alternatives
    if (wasExplicitProvider) {
      log.info(() => ({
        message: 'no alternative providers (explicit provider specified)',
        modelID,
        failedProviderID,
      }));
      return [];
    }

    // Check if this is a shared model
    const sharedProviders = SHARED_FREE_MODELS[modelID];
    if (!sharedProviders) {
      // Not a shared model, no alternatives
      return [];
    }

    // Get alternative providers (excluding the failed one)
    const s = await state();
    const alternatives = sharedProviders.filter(
      (p) => p !== failedProviderID && s.providers[p]
    );

    if (alternatives.length > 0) {
      log.info(() => ({
        message: 'found alternative providers for rate-limited model',
        modelID,
        failedProviderID,
        alternatives,
      }));
    }

    return alternatives;
  }

  /**
   * Checks if an error indicates a rate limit issue.
   * @param error - The error to check
   * @returns true if the error indicates a rate limit
   */
  export function isRateLimitError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();

    return (
      message.includes('rate limit') ||
      message.includes('ratelimit') ||
      message.includes('too many requests') ||
      message.includes('429') ||
      name.includes('ratelimit')
    );
  }

  export const ModelNotFoundError = NamedError.create(
    'ProviderModelNotFoundError',
    z.object({
      providerID: z.string(),
      modelID: z.string(),
      suggestion: z.string().optional(),
    })
  );

  export const InitError = NamedError.create(
    'ProviderInitError',
    z.object({
      providerID: z.string(),
    })
  );
}
