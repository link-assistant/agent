import { Log } from '../util/log';
import { NoSuchModelError, type LanguageModel, type Provider as SDK } from 'ai';
import { ModelsDev } from './models';
import { Auth } from '../auth';
import { ClaudeOAuth } from '../auth/claude-oauth';
import { AuthPlugins } from '../auth/plugins';
import { AzureLogin } from '../auth/azure-login';
import { config, isVerbose } from '../config/config';
import { createEchoModel } from './echo';
import { createCacheModel } from './cache';
import { Kilo } from './kilo';
import { ParityLoaders } from './parity-loaders';
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
const log = Log.create({ service: 'provider' });

export const BUNDLED_PROVIDERS: Record<string, (options: any) => SDK> = {
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

export type Source = 'env' | 'config' | 'custom' | 'api';

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

export function createFormalAiProvider(
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

export const CUSTOM_LOADERS: Record<string, CustomLoader> = {
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
    // `agent auth login azure` with Microsoft Entra ID stores no secret:
    // requests mint bearer tokens from the Azure CLI session (#334).
    const entra = await AzureLogin.options(await Auth.get('azure'));
    if (entra) {
      log.info(() => ({ message: 'using azure entra id credentials' }));
    }
    return {
      autoload: !!entra,
      async getModel(sdk: any, modelID: string, options?: Record<string, any>) {
        if (options?.['useCompletionUrls']) {
          return sdk.chat(modelID);
        } else {
          return sdk.responses(modelID);
        }
      },
      options: entra ?? {},
    };
  },
  'azure-cognitive-services': async () => {
    const resourceName = process.env['AZURE_COGNITIVE_SERVICES_RESOURCE_NAME'];
    return {
      autoload: false,
      async getModel(sdk: any, modelID: string, options?: Record<string, any>) {
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
        const result = await loaderFn(() => Auth.get('github-copilot'), input);
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
