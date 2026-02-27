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
import { createEchoModel } from './echo';
import { createCacheModel } from './cache';
import { RetryFetch } from './retry-fetch';

// Direct imports for bundled providers - these are pre-installed to avoid runtime installation hangs
// @see https://github.com/link-assistant/agent/issues/173
// @see https://github.com/oven-sh/bun/issues/5831 (bun install hangs sporadically)
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createXai } from '@ai-sdk/xai';
import { createMistral } from '@ai-sdk/mistral';
import { createGroq } from '@ai-sdk/groq';

export namespace Provider {
  const log = Log.create({ service: 'provider' });

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
  };

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
     * Kilo provider - access to 500+ AI models through Kilo Gateway
     * Uses OpenRouter-compatible API at https://api.kilo.ai/api/openrouter
     *
     * Authentication required: run `agent auth login` and select "Kilo Gateway"
     * For API key authentication, set KILO_API_KEY environment variable
     *
     * Free models available after authentication:
     * - GLM-5 (z-ai/glm-5) - Free limited time, flagship Z.AI model
     * - GLM 4.7 (z-ai/glm-4.7:free) - Free, agent-centric model
     * - Kimi K2.5 (moonshot/kimi-k2.5:free) - Free, agentic capabilities
     * - MiniMax M2.1 (minimax/m2.1:free) - Free, general-purpose
     * - Giga Potato (giga-potato:free) - Free evaluation model
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
        autoload: Flag.OPENCODE_DRY_RUN, // Auto-load only in dry-run mode
        async getModel(_sdk: any, modelID: string) {
          // Return our custom echo model that implements LanguageModelV1
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

          // Return our custom cache model that implements LanguageModelV1
          return createCacheModel(providerId, actualModelId);
        },
        options: {},
      };
    },
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

    // Add Kilo provider for access to 500+ AI models through Kilo Gateway
    // Free models available: GLM-5, GLM 4.7, Kimi K2.5, MiniMax M2.1, Giga Potato
    // @see https://kilo.ai/docs/gateway
    // @see https://github.com/link-assistant/agent/issues/159
    database['kilo'] = {
      id: 'kilo',
      name: 'Kilo Gateway',
      npm: '@openrouter/ai-sdk-provider',
      api: 'https://api.kilo.ai/api/openrouter',
      env: ['KILO_API_KEY'],
      models: {
        // GLM-5 - Flagship Z.AI model, free tier
        // Kilo API model ID: z-ai/glm-5:free (NOT z-ai/glm-5 which is paid)
        'glm-5-free': {
          id: 'z-ai/glm-5:free',
          name: 'GLM-5 (Free)',
          release_date: '2026-02-11',
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
            context: 202800,
            output: 131072,
          },
          modalities: {
            input: ['text'],
            output: ['text'],
          },
          options: {},
        },
        // GLM 4.5 Air - Free Z.AI model (replaces non-existent glm-4.7:free)
        // Kilo API model ID: z-ai/glm-4.5-air:free
        'glm-4.5-air-free': {
          id: 'z-ai/glm-4.5-air:free',
          name: 'GLM 4.5 Air (Free)',
          release_date: '2026-01-15',
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
            context: 131072,
            output: 96000,
          },
          modalities: {
            input: ['text'],
            output: ['text'],
          },
          options: {},
        },
        // MiniMax M2.5 - General-purpose, free (upgraded from M2.1)
        // Kilo API model ID: minimax/minimax-m2.5:free
        'minimax-m2.5-free': {
          id: 'minimax/minimax-m2.5:free',
          name: 'MiniMax M2.5 (Free)',
          release_date: '2026-01-01',
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
            context: 204800,
            output: 131072,
          },
          modalities: {
            input: ['text'],
            output: ['text'],
          },
          options: {},
        },
        // Giga Potato - Free evaluation model
        // Kilo API model ID: giga-potato (no :free suffix)
        'giga-potato-free': {
          id: 'giga-potato',
          name: 'Giga Potato (Free)',
          release_date: '2026-01-01',
          attachment: true,
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
            context: 256000,
            output: 32000,
          },
          modalities: {
            input: ['text', 'image'],
            output: ['text'],
          },
          options: {},
        },
        // Trinity Large Preview - Preview model from Arcee AI
        // Kilo API model ID: arcee-ai/trinity-large-preview:free
        'trinity-large-preview': {
          id: 'arcee-ai/trinity-large-preview:free',
          name: 'Trinity Large Preview (Free)',
          release_date: '2026-01-01',
          attachment: false,
          reasoning: false,
          temperature: true,
          tool_call: true,
          cost: {
            input: 0,
            output: 0,
            cache_read: 0,
            cache_write: 0,
          },
          limit: {
            context: 131000,
            output: 65536,
          },
          modalities: {
            input: ['text'],
            output: ['text'],
          },
          options: {},
        },
        // DeepSeek R1 - Reasoning model, free
        // Kilo API model ID: deepseek/deepseek-r1-0528:free
        'deepseek-r1-free': {
          id: 'deepseek/deepseek-r1-0528:free',
          name: 'DeepSeek R1 (Free)',
          release_date: '2025-05-28',
          attachment: false,
          reasoning: true,
          temperature: true,
          tool_call: false,
          cost: {
            input: 0,
            output: 0,
            cache_read: 0,
            cache_write: 0,
          },
          limit: {
            context: 163840,
            output: 163840,
          },
          modalities: {
            input: ['text'],
            output: ['text'],
          },
          options: {},
        },
      },
    };

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
      log.info(() => ({ message: 'found', providerID }));
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

      // Wrap fetch with verbose HTTP logging for debugging provider issues.
      // IMPORTANT: The verbose check is done at call time (not SDK creation time)
      // because the SDK is cached and Flag.OPENCODE_VERBOSE may change after creation.
      // When verbose is disabled, the wrapper is a no-op passthrough with negligible overhead.
      // See: https://github.com/link-assistant/agent/issues/200
      // See: https://github.com/link-assistant/agent/issues/206
      {
        const innerFetch = options['fetch'];
        options['fetch'] = async (
          input: RequestInfo | URL,
          init?: RequestInit
        ): Promise<Response> => {
          // Check verbose flag at call time — not at SDK creation time
          if (!Flag.OPENCODE_VERBOSE) {
            return innerFetch(input, init);
          }

          const url =
            typeof input === 'string'
              ? input
              : input instanceof URL
                ? input.toString()
                : input.url;
          const method = init?.method ?? 'GET';

          // Sanitize headers - mask authorization values
          const sanitizedHeaders: Record<string, string> = {};
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
          let bodyPreview: string | undefined;
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
                bodyStr.length > 2000
                  ? bodyStr.slice(0, 2000) +
                    `... [truncated, total ${bodyStr.length} chars]`
                  : bodyStr;
            }
          }

          log.info(() => ({
            message: 'HTTP request',
            providerID: provider.id,
            method,
            url,
            headers: sanitizedHeaders,
            bodyPreview,
          }));

          const startMs = Date.now();
          try {
            const response = await innerFetch(input, init);
            const durationMs = Date.now() - startMs;

            log.info(() => ({
              message: 'HTTP response',
              providerID: provider.id,
              method,
              url,
              status: response.status,
              statusText: response.statusText,
              durationMs,
              responseHeaders: Object.fromEntries(response.headers.entries()),
            }));

            // Log response body for debugging provider failures
            // For streaming responses (SSE/event-stream), tee() the stream so the AI SDK
            // still receives the full stream while we asynchronously log a preview.
            // For non-streaming responses, buffer the body and reconstruct the Response.
            // See: https://github.com/link-assistant/agent/issues/204
            const responseBodyMaxChars = 4000;
            const contentType = response.headers.get('content-type') ?? '';
            const isStreaming =
              contentType.includes('event-stream') ||
              contentType.includes('octet-stream');

            if (response.body) {
              if (isStreaming) {
                // Tee the stream: one copy for AI SDK, one for logging
                const [sdkStream, logStream] = response.body.tee();

                // Consume log stream asynchronously (does not block SDK)
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
                    log.info(() => ({
                      message: 'HTTP response body (stream)',
                      providerID: provider.id,
                      url,
                      bodyPreview: truncated
                        ? bodyPreview + `... [truncated]`
                        : bodyPreview,
                    }));
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
                log.info(() => ({
                  message: 'HTTP response body',
                  providerID: provider.id,
                  url,
                  bodyPreview,
                }));
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
            log.error(() => ({
              message: 'HTTP request failed',
              providerID: provider.id,
              method,
              url,
              durationMs,
              error:
                error instanceof Error
                  ? { name: error.name, message: error.message }
                  : String(error),
            }));
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
    return state().then((s) => s.providers[providerID]);
  }

  export async function getModel(providerID: string, modelID: string) {
    const key = `${providerID}/${modelID}`;
    const s = await state();
    if (s.models.has(key)) return s.models.get(key)!;

    log.info(() => ({ message: 'getModel', providerID, modelID }));

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

    // For synthetic providers, we don't need model info from the database
    let info = isSyntheticProvider ? null : provider.info.models[modelID];
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
        if (freshProvider?.models[modelID]) {
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
      // Still not found after refresh - create fallback info and try anyway
      // Provider may support unlisted models
      const availableInProvider = Object.keys(provider.info.models).slice(
        0,
        10
      );
      log.warn(() => ({
        message:
          'model not in provider catalog after refresh - attempting anyway (may be unlisted)',
        providerID,
        modelID,
        availableModels: availableInProvider,
        totalModels: Object.keys(provider.info.models).length,
      }));

      // Create a minimal fallback model info so SDK loading can proceed
      // Use sensible defaults - the provider will reject if the model truly doesn't exist
      info = {
        id: modelID,
        name: modelID,
        release_date: '',
        attachment: false,
        reasoning: false,
        temperature: true,
        tool_call: true,
        cost: { input: 0, output: 0 },
        limit: { context: 128000, output: 16384 },
        options: {},
      } as ModelsDev.Model;
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
        language = provider.getModel
          ? await provider.getModel(sdk, realID, provider.options)
          : sdk.languageModel(realID);
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
      priority = [
        'kimi-k2.5-free',
        'minimax-m2.5-free',
        'gpt-5-nano',
        'big-pickle',
      ];
    }
    if (providerID === 'kilo') {
      priority = [
        'glm-5-free',
        'glm-4.5-air-free',
        'minimax-m2.5-free',
        'deepseek-r1-free',
        'giga-potato-free',
      ];
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
    'glm-5-free',
    'kimi-k2.5-free',
    'minimax-m2.5-free',
    'gpt-5-nano',
    'big-pickle',
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
    if (Flag.OPENCODE_DRY_RUN) {
      log.info('dry-run mode enabled, using echo provider as default');
      return {
        providerID: 'link-assistant',
        modelID: 'echo',
      };
    }

    if (cfg.model) return parseModel(cfg.model);

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
      providerID: providerID,
      modelID: rest.join('/'),
    };
  }

  /**
   * Resolve a short model name (without provider prefix) to the appropriate provider.
   * This function finds which provider should handle a model when no explicit provider is specified.
   *
   * Priority for free models:
   * 1. If model is uniquely available in one provider, use that provider
   * 2. If model is available in multiple providers, prioritize based on free model availability:
   *    - kilo: glm-5-free, glm-4.5-air-free, minimax-m2.5-free, giga-potato-free, deepseek-r1-free (unique to Kilo)
   *    - opencode: big-pickle, gpt-5-nano (unique to OpenCode)
   * 3. For shared models, prefer OpenCode first, then fall back to Kilo on rate limit
   *
   * @param modelID - Short model name without provider prefix
   * @returns Provider ID that should handle this model, or undefined if not found
   */
  export async function resolveShortModelName(
    modelID: string
  ): Promise<{ providerID: string; modelID: string } | undefined> {
    const s = await state();

    // Define model-to-provider mappings for free models
    // Models unique to Kilo (GLM models from Z.AI are only free on Kilo)
    const kiloUniqueModels = [
      'glm-5-free',
      'glm-4.5-air-free',
      'minimax-m2.5-free',
      'giga-potato-free',
      'trinity-large-preview',
      'deepseek-r1-free',
    ];

    // Check if it's a Kilo-unique model
    if (kiloUniqueModels.includes(modelID)) {
      const kiloProvider = s.providers['kilo'];
      if (kiloProvider && kiloProvider.info.models[modelID]) {
        log.info(() => ({
          message: 'resolved short model name to kilo (unique)',
          modelID,
        }));
        return { providerID: 'kilo', modelID };
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
      log.info(() => ({
        message: 'resolved short model name (single match)',
        modelID,
        providerID,
      }));
      return { providerID, modelID };
    }

    // Multiple providers have this model - prefer OpenCode for shared free models
    // This follows the convention that opencode is the primary free provider
    if (matchingProviders.includes('opencode')) {
      log.info(() => ({
        message: 'resolved short model name to opencode (multiple providers)',
        modelID,
        availableProviders: matchingProviders,
      }));
      return { providerID: 'opencode', modelID };
    }

    // Fallback to first matching provider
    const providerID = matchingProviders[0];
    log.info(() => ({
      message: 'resolved short model name (fallback)',
      modelID,
      providerID,
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
   * - "kilo/glm-5-free" -> { providerID: "kilo", modelID: "glm-5-free" }
   * - "glm-5-free" -> { providerID: "kilo", modelID: "glm-5-free" } (resolved)
   * - "kimi-k2.5-free" -> { providerID: "opencode", modelID: "kimi-k2.5-free" } (resolved)
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
   * If user specifies "kilo/kimi-k2.5-free", no fallback will occur.
   */
  const SHARED_FREE_MODELS: Record<string, string[]> = {
    // Currently no shared models between OpenCode and Kilo providers.
    // Kilo models use different IDs than OpenCode models.
  };

  /**
   * Get alternative providers for a model when the primary provider fails (e.g., rate limited).
   * This function returns a list of alternative providers that offer the same model.
   *
   * Note: This only returns alternatives for models without explicit provider specification.
   * If the original request had an explicit provider (like "kilo/kimi-k2.5-free"), this returns empty array.
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
