import type { ModelsDev } from './models';
import { EnvTemplate } from './env-template';
import { BunProc } from '../bun';
import { Log } from '../util/log';

/**
 * Provider loaders that bring the agent to parity with OpenCode
 * (https://github.com/anomalyco/opencode, `packages/core/src/plugin/provider`)
 * for providers whose models.dev entry alone is not enough: attribution
 * headers, templated endpoints, cloud credential chains and gateway routing.
 *
 * Each loader receives the catalogue entry (which may be missing) and returns
 * the same shape as the loaders in `provider.ts`.
 *
 * @see https://github.com/link-assistant/agent/issues/334
 */
export namespace ParityLoaders {
  const log = Log.create({ service: 'provider-parity' });

  type Env = Record<string, string | undefined>;

  export interface LoaderResult {
    autoload: boolean;
    getModel?: (
      sdk: any,
      modelID: string,
      options?: Record<string, any>
    ) => Promise<any>;
    options?: Record<string, any>;
    /**
     * Adjust the SDK options for one package. Used by providers whose models
     * are served by several SDK packages (Vertex: Gemini, Anthropic and
     * OpenAI-compatible endpoints) that need different credentials.
     */
    sdkOptions?: (
      pkg: string,
      options: Record<string, any>
    ) => Record<string, any>;
  }

  export type Loader = (
    provider: ModelsDev.Provider | undefined
  ) => Promise<LoaderResult>;

  const ATTRIBUTION = {
    'HTTP-Referer': 'https://opencode.ai/',
    'X-Title': 'opencode',
  };

  export const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1';
  export const LLMGATEWAY_URL = 'https://api.llmgateway.io/v1';

  function first(env: Env, names: string[]) {
    for (const name of names) {
      const value = env[name]?.trim();
      if (value) return value;
    }
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Cloudflare
  // ---------------------------------------------------------------------------

  export const CLOUDFLARE_WORKERS_TOKEN_ENV = [
    'CLOUDFLARE_API_KEY',
    'CLOUDFLARE_WORKERS_AI_TOKEN',
    'CLOUDFLARE_API_TOKEN',
  ];
  export const CLOUDFLARE_GATEWAY_TOKEN_ENV = [
    'CLOUDFLARE_API_TOKEN',
    'CF_AIG_TOKEN',
  ];
  const CLOUDFLARE_GATEWAY_HOST = 'gateway.ai.cloudflare.com';

  export function cloudflareChatURL(accountID: string) {
    return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountID)}/ai/v1`;
  }

  function cloudflareGatewayID(env: Env) {
    return env['CLOUDFLARE_GATEWAY_ID']?.trim() || 'default';
  }

  function cloudflarePassthroughURL(
    accountID: string,
    gatewayID: string,
    route: 'openai' | 'anthropic/v1'
  ) {
    return `https://${CLOUDFLARE_GATEWAY_HOST}/v1/${encodeURIComponent(accountID)}/${encodeURIComponent(gatewayID)}/${route}`;
  }

  /**
   * Route Cloudflare AI Gateway models the way OpenCode does: `openai/*` to the
   * Responses API and `anthropic/*` to the Messages API through the gateway
   * passthrough (unified billing), everything else to the Workers AI chat
   * endpoint. models.dev ships the gateway as `ai-gateway-provider`, which
   * does not load with the bundled AI SDK, so every model gets a bundled
   * package instead. Mutates `database`.
   */
  export function patchCloudflareGateway(
    database: Record<string, ModelsDev.Provider>,
    env: Env = process.env,
    customBaseURL?: string
  ) {
    const provider = database['cloudflare-ai-gateway'];
    if (!provider) return;
    const accountID = env['CLOUDFLARE_ACCOUNT_ID']?.trim();
    const gatewayID = cloudflareGatewayID(env);
    provider.npm = '@ai-sdk/openai-compatible';
    if (customBaseURL) {
      provider.api = customBaseURL;
      for (const model of Object.values(provider.models)) {
        model.provider = undefined;
      }
      return;
    }
    provider.api = accountID ? cloudflareChatURL(accountID) : undefined;
    for (const [key, model] of Object.entries(provider.models)) {
      if (key.startsWith('openai/') && accountID) {
        model.id = key.slice('openai/'.length);
        model.provider = {
          npm: '@ai-sdk/openai',
          api: cloudflarePassthroughURL(accountID, gatewayID, 'openai'),
          shape: 'responses',
        };
        continue;
      }
      if (key.startsWith('anthropic/') && accountID) {
        model.id = key.slice('anthropic/'.length).replaceAll('.', '-');
        model.provider = {
          npm: '@ai-sdk/anthropic',
          api: cloudflarePassthroughURL(accountID, gatewayID, 'anthropic/v1'),
        };
        continue;
      }
      if (key.startsWith('workers-ai/')) {
        model.id = key.slice('workers-ai/'.length);
      }
      model.provider = undefined;
    }
  }

  /**
   * The passthrough routes authenticate with `cf-aig-authorization` only;
   * the SDK's own `Authorization` / `x-api-key` header would be forwarded to
   * the upstream provider, so it is removed there.
   */
  export function cloudflareGatewayFetch(
    token: string,
    inner: typeof fetch = fetch
  ): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (new URL(url).host !== CLOUDFLARE_GATEWAY_HOST) {
        return inner(input, init);
      }
      const headers = new Headers(init?.headers);
      headers.delete('authorization');
      headers.delete('x-api-key');
      headers.delete('cf-aig-gateway-id');
      headers.set('cf-aig-authorization', `Bearer ${token}`);
      return inner(input, { ...init, headers });
    }) as typeof fetch;
  }

  function cloudflareGatewayHeaders(env: Env) {
    const headers: Record<string, string> = {
      'cf-aig-gateway-id': cloudflareGatewayID(env),
    };
    const optional: Record<string, string> = {
      CLOUDFLARE_GATEWAY_METADATA: 'cf-aig-metadata',
      CLOUDFLARE_GATEWAY_CACHE_TTL: 'cf-aig-cache-ttl',
      CLOUDFLARE_GATEWAY_CACHE_KEY: 'cf-aig-cache-key',
      CLOUDFLARE_GATEWAY_SKIP_CACHE: 'cf-aig-skip-cache',
      CLOUDFLARE_GATEWAY_COLLECT_LOG: 'cf-aig-collect-log',
    };
    for (const [name, header] of Object.entries(optional)) {
      const value = env[name]?.trim();
      if (value) headers[header] = value;
    }
    return headers;
  }

  // ---------------------------------------------------------------------------
  // Snowflake Cortex
  // ---------------------------------------------------------------------------

  export const SNOWFLAKE_TOKEN_ENV = [
    'SNOWFLAKE_CORTEX_TOKEN',
    'SNOWFLAKE_CORTEX_PAT',
  ];

  const SNOWFLAKE_STOP_STREAM =
    'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';

  /**
   * Cortex Chat Completions expects `max_completion_tokens` and answers a
   * finished conversation with HTTP 400 "conversation complete"; OpenCode
   * turns that into a normal stop. Same here.
   */
  export function snowflakeFetch(inner: typeof fetch = fetch): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      let request = init;
      if (typeof init?.body === 'string') {
        try {
          const body = JSON.parse(init.body);
          if (
            body &&
            typeof body === 'object' &&
            body.max_tokens !== undefined &&
            body.max_completion_tokens === undefined
          ) {
            body.max_completion_tokens = body.max_tokens;
            delete body.max_tokens;
            request = { ...init, body: JSON.stringify(body) };
          }
        } catch {
          // Not JSON, send unchanged.
        }
      }
      const response = await inner(input, request);
      if (response.status !== 400) return response;
      const text = await response
        .clone()
        .text()
        .catch(() => '');
      let message = text;
      try {
        const parsed = JSON.parse(text);
        message = String(parsed?.message || parsed?.error || '');
      } catch {
        // Keep the raw text.
      }
      if (!message.toLowerCase().includes('conversation complete')) {
        return response;
      }
      return new Response(SNOWFLAKE_STOP_STREAM, {
        headers: { 'content-type': 'text/event-stream' },
      });
    }) as typeof fetch;
  }

  // ---------------------------------------------------------------------------
  // Google Vertex AI
  // ---------------------------------------------------------------------------

  /** Placeholder key for SDKs that require one; replaced by an ADC token. */
  export const VERTEX_ADC_PLACEHOLDER = 'google-vertex-adc';

  let googleAuth: Promise<any> | undefined;

  async function vertexAccessToken(): Promise<string | undefined> {
    googleAuth ??= import('google-auth-library').then(
      ({ GoogleAuth }) =>
        new GoogleAuth({
          scopes: 'https://www.googleapis.com/auth/cloud-platform',
        })
    );
    const auth = await googleAuth;
    const token = await auth.getAccessToken();
    return typeof token === 'string' ? token : (token?.token ?? undefined);
  }

  /**
   * Vertex serves partner models (OpenAI-compatible `endpoints/openapi`,
   * Mistral) through plain HTTP SDKs that know nothing about Google
   * credentials. Add an Application Default Credentials bearer token to
   * requests for `*aiplatform.googleapis.com` that carry no real credential.
   */
  /** `aiplatform.googleapis.com` and regional `{location}-aiplatform...`. */
  const VERTEX_HOST = /^(?:[a-z0-9-]+-)?aiplatform\.googleapis\.com$/i;

  export function vertexFetch(
    inner: typeof fetch = fetch,
    token: () => Promise<string | undefined> = vertexAccessToken
  ): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (!VERTEX_HOST.test(new URL(url).hostname)) {
        return inner(input, init);
      }
      const headers = new Headers(init?.headers);
      const current = headers.get('authorization');
      if (
        headers.has('x-goog-api-key') ||
        (current && current !== `Bearer ${VERTEX_ADC_PLACEHOLDER}`)
      ) {
        return inner(input, init);
      }
      const access = await token();
      if (access) headers.set('authorization', `Bearer ${access}`);
      else headers.delete('authorization');
      return inner(input, { ...init, headers });
    }) as typeof fetch;
  }

  function vertexSdkOptions(pkg: string, options: Record<string, any>) {
    if (pkg === '@ai-sdk/google-vertex') return options;
    if (pkg === '@ai-sdk/google-vertex/anthropic') {
      const { apiKey: _apiKey, ...rest } = options;
      return rest;
    }
    // Partner models: the base URL comes from the model entry and the
    // credential from ADC (see `vertexFetch`).
    const {
      apiKey: _apiKey,
      project: _project,
      location: _location,
      ...rest
    } = options;
    return { ...rest, apiKey: VERTEX_ADC_PLACEHOLDER };
  }

  export function vertexSettings(env: Env = process.env) {
    const derived = EnvTemplate.derived(env);
    return {
      project: derived['GOOGLE_VERTEX_PROJECT'],
      location: derived['GOOGLE_VERTEX_LOCATION'] ?? 'global',
      apiKey: env['GOOGLE_VERTEX_API_KEY']?.trim() || undefined,
    };
  }

  // ---------------------------------------------------------------------------
  // Amazon Bedrock
  // ---------------------------------------------------------------------------

  /**
   * Ambient inputs the AWS default credential chain can turn into
   * credentials (same list as OpenCode's Bedrock plugin).
   */
  export const AWS_CHAIN_ENV = [
    'AWS_PROFILE',
    'AWS_ACCESS_KEY_ID',
    'AWS_WEB_IDENTITY_TOKEN_FILE',
    'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
    'AWS_CONTAINER_CREDENTIALS_FULL_URI',
  ];

  export function awsRegion(env: Env = process.env) {
    return env['AWS_REGION'] ?? env['AWS_DEFAULT_REGION'] ?? 'us-east-1';
  }

  /**
   * Cross-region inference profile prefix for Bedrock model IDs.
   */
  export function bedrockModelID(modelID: string, region: string): string {
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
          return `${regionPrefix}.${modelID}`;
        }
        return modelID;
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
          return `${regionPrefix}.${modelID}`;
        }
        return modelID;
      }
      case 'ap': {
        const isAustraliaRegion = ['ap-southeast-2', 'ap-southeast-4'].includes(
          region
        );
        if (
          isAustraliaRegion &&
          ['anthropic.claude-sonnet-4-5', 'anthropic.claude-haiku'].some((m) =>
            modelID.includes(m)
          )
        ) {
          return `au.${modelID}`;
        }
        const modelRequiresPrefix = [
          'claude',
          'nova-lite',
          'nova-micro',
          'nova-pro',
        ].some((m) => modelID.includes(m));
        if (modelRequiresPrefix) {
          regionPrefix = 'apac';
          return `${regionPrefix}.${modelID}`;
        }
        return modelID;
      }
    }
    return modelID;
  }

  // ---------------------------------------------------------------------------
  // API shape routing
  // ---------------------------------------------------------------------------

  export const BEDROCK_MANTLE_NPM = '@ai-sdk/amazon-bedrock/mantle';

  /**
   * Pick the language model factory a catalogue entry asks for. Returns
   * `undefined` when the entry has no preference, so the provider's own
   * `getModel` (or `sdk.languageModel`) applies.
   */
  export function selectByShape(
    sdk: any,
    info: ModelsDev.Model | undefined,
    modelID: string
  ): any {
    if (!sdk || !info?.provider) return undefined;
    if (info.provider.npm === BEDROCK_MANTLE_NPM) {
      // Same routing as OpenCode: gpt-oss models are Chat Completions only.
      if (modelID.includes('gpt-oss') && typeof sdk.chat === 'function') {
        return sdk.chat(modelID);
      }
      if (typeof sdk.responses === 'function') return sdk.responses(modelID);
      return undefined;
    }
    if (info.provider.shape === 'responses') {
      if (typeof sdk.responses === 'function') return sdk.responses(modelID);
    }
    if (info.provider.shape === 'completions') {
      if (typeof sdk.chat === 'function') return sdk.chat(modelID);
    }
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Loaders
  // ---------------------------------------------------------------------------

  export function create(env: Env = process.env): Record<string, Loader> {
    return {
      async nvidia(input) {
        if (input?.api !== NVIDIA_URL) return { autoload: false };
        return {
          autoload: false,
          options: {
            headers: { ...ATTRIBUTION, 'X-BILLING-INVOKE-ORIGIN': 'OpenCode' },
          },
        };
      },
      async llmgateway(input) {
        if (input?.api !== LLMGATEWAY_URL) return { autoload: false };
        return {
          autoload: false,
          options: { headers: { ...ATTRIBUTION, 'X-Source': 'opencode' } },
        };
      },
      async cerebras() {
        return {
          autoload: false,
          options: {
            headers: { 'X-Cerebras-3rd-Party-Integration': 'opencode' },
          },
        };
      },
      async 'cloudflare-workers-ai'() {
        const token = first(env, CLOUDFLARE_WORKERS_TOKEN_ENV);
        const accountID = env['CLOUDFLARE_ACCOUNT_ID']?.trim();
        const options: Record<string, any> = {};
        if (token) options.apiKey = token;
        if (accountID) options.baseURL = cloudflareChatURL(accountID);
        return { autoload: Boolean(token && accountID), options };
      },
      async 'cloudflare-ai-gateway'() {
        const token = first(env, CLOUDFLARE_GATEWAY_TOKEN_ENV);
        const accountID = env['CLOUDFLARE_ACCOUNT_ID']?.trim();
        if (!token) return { autoload: false };
        return {
          autoload: Boolean(accountID),
          options: {
            apiKey: token,
            headers: cloudflareGatewayHeaders(env),
            fetch: cloudflareGatewayFetch(token),
          },
        };
      },
      async 'snowflake-cortex'(input) {
        const token = first(env, SNOWFLAKE_TOKEN_ENV);
        const baseURL = EnvTemplate.resolve(input?.api, env);
        const options: Record<string, any> = { fetch: snowflakeFetch() };
        if (token) options.apiKey = token;
        if (baseURL) options.baseURL = baseURL;
        return { autoload: Boolean(token && baseURL), options };
      },
      async 'sap-ai-core'() {
        if (!env['AICORE_SERVICE_KEY']) return { autoload: false };
        const options: Record<string, any> = {};
        if (env['AICORE_DEPLOYMENT_ID']) {
          options.deploymentId = env['AICORE_DEPLOYMENT_ID'];
        }
        if (env['AICORE_RESOURCE_GROUP']) {
          options.resourceGroup = env['AICORE_RESOURCE_GROUP'];
        }
        return {
          autoload: true,
          options,
          async getModel(sdk: any, modelID: string) {
            return typeof sdk === 'function'
              ? sdk(modelID)
              : sdk.languageModel(modelID);
          },
        };
      },
      async 'google-vertex'() {
        const { project, location, apiKey } = vertexSettings(env);
        if (!project && !apiKey) return { autoload: false };
        return {
          autoload: true,
          options: {
            ...(project ? { project } : {}),
            location,
            ...(apiKey ? { apiKey } : {}),
            fetch: vertexFetch(),
          },
          sdkOptions: vertexSdkOptions,
          async getModel(sdk: any, modelID: string) {
            return sdk.languageModel(String(modelID).trim());
          },
        };
      },
      async 'google-vertex-anthropic'() {
        const { project, location } = vertexSettings(env);
        if (!project) return { autoload: false };
        return {
          autoload: true,
          options: { project, location },
          async getModel(sdk: any, modelID: string) {
            return sdk.languageModel(String(modelID).trim());
          },
        };
      },
      async 'amazon-bedrock'() {
        const chain = AWS_CHAIN_ENV.some((name) => env[name]);
        const bearer = env['AWS_BEARER_TOKEN_BEDROCK']?.trim();
        if (!chain && !bearer) return { autoload: false };
        const region = awsRegion(env);
        const options: Record<string, any> = { region };
        if (bearer) options.apiKey = bearer;
        if (chain) {
          try {
            const { fromNodeProviderChain } = await import(
              await BunProc.install('@aws-sdk/credential-providers')
            );
            options.credentialProvider = fromNodeProviderChain();
          } catch (error) {
            log.warn(() => ({
              message: 'AWS credential chain unavailable',
              error: error instanceof Error ? error.message : String(error),
            }));
            if (!bearer) return { autoload: false };
          }
        }
        return {
          autoload: true,
          options,
          async getModel(sdk: any, modelID: string) {
            return sdk.languageModel(bedrockModelID(modelID, region));
          },
        };
      },
    };
  }
}
