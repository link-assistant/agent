import { describe, expect, test } from 'bun:test';
import { EnvTemplate } from '../src/provider/env-template';
import { ExtraProviders } from '../src/provider/extra-providers';
import { ModelDiscovery } from '../src/provider/model-discovery';
import { ParityLoaders } from '../src/provider/parity-loaders';
import { Kilo } from '../src/provider/kilo';
import type { ModelsDev } from '../src/provider/models';

/**
 * OpenCode provider parity, gpt4free and dynamic model discovery (#334).
 * Unit tests for the pure helpers; the registry wiring is exercised end to end
 * by `experiments/issue-334/probe-registry.ts` at the bottom of this file.
 */

function model(
  id: string,
  extra: Partial<ModelsDev.Model> = {}
): ModelsDev.Model {
  return {
    id,
    name: id,
    release_date: '',
    attachment: false,
    reasoning: false,
    temperature: true,
    tool_call: true,
    cost: { input: 1, output: 2 },
    limit: { context: 1000, output: 100 },
    options: {},
    ...extra,
  };
}

describe('EnvTemplate (#334)', () => {
  test('resolves ${VAR} placeholders and refuses half-filled URLs', () => {
    expect(
      EnvTemplate.resolve('https://${DATABRICKS_HOST}/v1', {
        DATABRICKS_HOST: 'https://dbc-1.cloud.databricks.com/',
      })
    ).toBe('https://dbc-1.cloud.databricks.com/v1');
    expect(EnvTemplate.resolve('https://${MISSING_HOST}/v1', {})).toBe(
      undefined
    );
    expect(EnvTemplate.resolve('https://plain/v1', {})).toBe(
      'https://plain/v1'
    );
  });

  test('derives Snowflake account, Vertex endpoint and AWS region', () => {
    const env = {
      SNOWFLAKE_ACCOUNT: 'https://abc.snowflakecomputing.com/',
      GOOGLE_CLOUD_PROJECT: 'proj',
      GOOGLE_VERTEX_LOCATION: 'europe-west4',
    };
    expect(
      EnvTemplate.resolve(
        'https://${SNOWFLAKE_ACCOUNT}.snowflakecomputing.com/api',
        env
      )
    ).toBe('https://abc.snowflakecomputing.com/api');
    expect(
      EnvTemplate.resolve(
        'https://${GOOGLE_VERTEX_ENDPOINT}/v1/projects/${GOOGLE_VERTEX_PROJECT}/locations/${GOOGLE_VERTEX_LOCATION}',
        env
      )
    ).toBe(
      'https://europe-west4-aiplatform.googleapis.com/v1/projects/proj/locations/europe-west4'
    );
    expect(EnvTemplate.derived({}).GOOGLE_VERTEX_ENDPOINT).toBe(
      'aiplatform.googleapis.com'
    );
    expect(EnvTemplate.derived({}).AWS_REGION).toBe('us-east-1');
  });

  test('template, account and region variables are never used as API keys', () => {
    const provider: ModelsDev.Provider = {
      id: 'cloudflare-workers-ai',
      name: 'Cloudflare',
      api: 'https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1',
      env: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_KEY'],
      models: {},
    };
    expect(EnvTemplate.credentialEnv(provider)).toEqual(['CLOUDFLARE_API_KEY']);
    expect(
      EnvTemplate.credentialEnv({
        ...provider,
        api: undefined,
        env: [
          'AWS_ACCESS_KEY_ID',
          'AWS_SECRET_ACCESS_KEY',
          'AWS_REGION',
          'AWS_BEARER_TOKEN_BEDROCK',
        ],
      })
    ).toEqual(['AWS_BEARER_TOKEN_BEDROCK']);
  });
});

describe('ModelDiscovery (#334)', () => {
  test('never calls a billable endpoint', () => {
    for (const url of [
      'https://api.openai.com/v1/chat/completions',
      'https://api.anthropic.com/v1/messages',
      'https://x/v1/responses',
      'https://g/v1beta/models/gemini:generateContent',
    ]) {
      expect(ModelDiscovery.isBillableUrl(url)).toBe(true);
      expect(() => ModelDiscovery.assertTokenFreeUrl(url)).toThrow();
    }
    expect(
      ModelDiscovery.isBillableUrl('https://api.openai.com/v1/models')
    ).toBe(false);
  });

  test('cache TTL is at least one hour; env can only raise it', () => {
    const hour = 60 * 60 * 1000;
    expect(ModelDiscovery.ttlMs({})).toBe(hour);
    expect(ModelDiscovery.ttlMs({ [ModelDiscovery.TTL_ENV]: '5' })).toBe(hour);
    expect(ModelDiscovery.ttlMs({ [ModelDiscovery.TTL_ENV]: '120' })).toBe(
      2 * hour
    );
    expect(
      ModelDiscovery.isEnabled({ [ModelDiscovery.DISABLE_ENV]: 'off' })
    ).toBe(false);
  });

  test('builds listing requests per API family', () => {
    expect(
      ModelDiscovery.listingRequest({
        providerID: 'anthropic',
        npm: '@ai-sdk/anthropic',
        apiKey: 'k',
      })
    ).toEqual({
      url: 'https://api.anthropic.com/v1/models?limit=1000',
      headers: { 'x-api-key': 'k', 'anthropic-version': '2023-06-01' },
      shape: 'anthropic',
    });
    expect(
      ModelDiscovery.listingRequest({
        providerID: 'gpt4free',
        baseURL: 'http://localhost:1337/v1/',
      })?.url
    ).toBe('http://localhost:1337/v1/models');
    expect(
      ModelDiscovery.listingRequest({
        providerID: 'kilo',
        npm: '@openrouter/ai-sdk-provider',
      })?.url
    ).toBe('https://api.kilo.ai/api/gateway/models');
    // Templated base URL that is not resolved yet: nothing to ask.
    expect(
      ModelDiscovery.listingRequest({
        providerID: 'databricks',
        baseURL: 'https://${DATABRICKS_HOST}/v1',
      })
    ).toBeUndefined();
    expect(
      ModelDiscovery.listingRequest({
        providerID: 'amazon-bedrock',
        npm: '@ai-sdk/amazon-bedrock',
      })
    ).toBeUndefined();
  });

  test('normalizes OpenRouter, gpt4free, Gemini and Anthropic listings', () => {
    const openai = ModelDiscovery.normalize('openai', {
      data: [
        {
          id: 'vendor/model:free',
          name: 'Model (free)',
          context_length: 131072,
          top_provider: { max_completion_tokens: 8192 },
          architecture: {
            input_modalities: ['text', 'image'],
            output_modalities: ['text'],
          },
          supported_parameters: ['tools', 'reasoning'],
          pricing: { prompt: '0', completion: '0' },
        },
        { id: 'flux', image: true },
        { id: 'embed', type: 'embedding' },
        { id: 'tts', architecture: { output_modalities: ['audio'] } },
      ],
    });
    expect(openai).toEqual([
      {
        id: 'vendor/model:free',
        name: 'Model (free)',
        context: 131072,
        output: 8192,
        toolCall: true,
        reasoning: true,
        attachment: true,
        input: ['text', 'image'],
        free: true,
        cost: { input: 0, output: 0 },
        releaseDate: undefined,
      },
    ]);
    expect(
      ModelDiscovery.normalize('gemini', {
        models: [
          {
            name: 'models/gemini-3-flash',
            inputTokenLimit: 1048576,
            outputTokenLimit: 65536,
            supportedGenerationMethods: ['generateContent'],
          },
          {
            name: 'models/embedding',
            supportedGenerationMethods: ['embedContent'],
          },
        ],
      }).map((m) => [m.id, m.context])
    ).toEqual([['gemini-3-flash', 1048576]]);
    expect(
      ModelDiscovery.normalize('anthropic', {
        data: [{ id: 'claude-x', display_name: 'Claude X' }],
      })[0].name
    ).toBe('Claude X');
  });

  test('finds models by exact ID, case-insensitively and by alias', () => {
    const models = ModelDiscovery.normalize('openai', [
      { id: 'Mock-Model' },
      { id: 'deepseek-v4-flash', aliases: ['deepseek'] },
    ]);
    expect(ModelDiscovery.findModel(models, 'Mock-Model')?.id).toBe(
      'Mock-Model'
    );
    expect(ModelDiscovery.findModel(models, 'mock-model')?.id).toBe(
      'Mock-Model'
    );
    expect(ModelDiscovery.findModel(models, 'deepseek')?.id).toBe(
      'deepseek-v4-flash'
    );
    expect(ModelDiscovery.findModel(models, 'missing')).toBeUndefined();
  });

  test('fills metadata from models.dev and reports free models as free', () => {
    const database = {
      openai: {
        id: 'openai',
        name: 'OpenAI',
        env: [],
        models: { 'gpt-x': model('gpt-x', { reasoning: true }) },
      },
    };
    const meta = ModelDiscovery.catalogueMetadata(
      database,
      'openai/gpt-x:free'
    );
    expect(meta?.id).toBe('gpt-x');
    const info = ModelDiscovery.toModelInfo(
      { id: 'openai/gpt-x:free', free: true },
      { metadata: meta }
    );
    expect(info.reasoning).toBe(true);
    expect(info.cost.input).toBe(0);
    expect(info.limit).toEqual({ context: 1000, output: 100 });
  });

  test('discover() caches listings and reports failures without throwing', async () => {
    ModelDiscovery.clearMemoryCache();
    let calls = 0;
    const fetchImpl = (async (url: string) => {
      calls++;
      expect(url).toBe('http://mock.invalid/v1/models');
      return Response.json({ data: [{ id: 'one' }] });
    }) as unknown as typeof fetch;
    const input = {
      providerID: `test-${Date.now()}`,
      baseURL: 'http://mock.invalid/v1',
      fetchImpl,
    };
    const first = await ModelDiscovery.discover(input);
    const second = await ModelDiscovery.discover(input);
    expect(first.status).toBe('ok');
    expect(second.cached).toBe(true);
    expect(calls).toBe(1);

    const failed = await ModelDiscovery.discover({
      providerID: `test-fail-${Date.now()}`,
      baseURL: 'http://mock.invalid/v1',
      fetchImpl: (async () =>
        new Response('nope', { status: 500 })) as unknown as typeof fetch,
    });
    expect(failed.status).toBe('error');
    expect(failed.models).toEqual([]);
  });
});

describe('ExtraProviders (#334)', () => {
  test('adds gpt4free, Pollinations and local servers without overriding models.dev', () => {
    const database: Record<string, ModelsDev.Provider> = {
      ollama: {
        id: 'ollama',
        name: 'from models.dev',
        env: [],
        models: {},
      },
      venice: {
        id: 'venice',
        name: 'Venice',
        npm: 'venice-ai-sdk-provider',
        env: ['VENICE_API_KEY'],
        models: {},
      },
    };
    ExtraProviders.augment(database, {});
    expect(database.gpt4free.api).toBe('http://localhost:1337/v1');
    expect(database.gpt4free.npm).toBe('@ai-sdk/openai-compatible');
    expect(database.pollinations.api).toBe('https://gen.pollinations.ai/v1');
    expect(database['g4f-space']).toBeDefined();
    expect(database.ollama.name).toBe('from models.dev');
    expect(database.venice.npm).toBe('@ai-sdk/openai-compatible');
    expect(database.venice.api).toBe('https://api.venice.ai/api/v1');
  });

  test('base URLs come from env; G4F_PROVIDER pins a gpt4free backend', () => {
    const gpt4free = ExtraProviders.get('g4f')!;
    expect(
      ExtraProviders.baseURL(gpt4free, { G4F_BASE_URL: 'http://box:1337/v1/' })
    ).toBe('http://box:1337/v1');
    expect(
      ExtraProviders.baseURL(gpt4free, { G4F_PROVIDER: 'PollinationsAI' })
    ).toBe('http://localhost:1337/api/PollinationsAI');
    expect(
      ExtraProviders.baseURL(ExtraProviders.get('ollama')!, {
        OLLAMA_HOST: '127.0.0.1:11434',
      })
    ).toBe('http://127.0.0.1:11434/v1');
  });

  test('aliases, keyless and passthrough flags', () => {
    expect(ExtraProviders.canonicalID('g4f')).toBe('gpt4free');
    expect(ExtraProviders.canonicalID('llama.cpp')).toBe('llamacpp');
    expect(ExtraProviders.canonicalID('openai')).toBe('openai');
    expect(ExtraProviders.isKeyless('gpt4free')).toBe(true);
    expect(ExtraProviders.isKeyless('lmstudio')).toBe(true);
    expect(ExtraProviders.isKeyless('airforce')).toBe(false);
    expect(ExtraProviders.allowsUnknownModels('ollama')).toBe(true);
    expect(ExtraProviders.allowsUnknownModels('openai')).toBe(false);
  });
});

describe('ParityLoaders (#334)', () => {
  test('Cloudflare AI Gateway routes models like OpenCode', () => {
    const database: Record<string, ModelsDev.Provider> = {
      'cloudflare-ai-gateway': {
        id: 'cloudflare-ai-gateway',
        name: 'Cloudflare AI Gateway',
        npm: 'ai-gateway-provider',
        env: [],
        models: {
          'openai/gpt-5': model('openai/gpt-5'),
          'anthropic/claude-sonnet-4.5': model('anthropic/claude-sonnet-4.5'),
          'workers-ai/@cf/meta/llama': model('workers-ai/@cf/meta/llama'),
        },
      },
    };
    ParityLoaders.patchCloudflareGateway(database, {
      CLOUDFLARE_ACCOUNT_ID: 'acct',
      CLOUDFLARE_GATEWAY_ID: 'gw',
    });
    const gateway = database['cloudflare-ai-gateway'];
    expect(gateway.npm).toBe('@ai-sdk/openai-compatible');
    expect(gateway.api).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct/ai/v1'
    );
    expect(gateway.models['openai/gpt-5'].id).toBe('gpt-5');
    expect(gateway.models['openai/gpt-5'].provider).toEqual({
      npm: '@ai-sdk/openai',
      api: 'https://gateway.ai.cloudflare.com/v1/acct/gw/openai',
      shape: 'responses',
    });
    expect(gateway.models['anthropic/claude-sonnet-4.5'].id).toBe(
      'claude-sonnet-4-5'
    );
    expect(gateway.models['anthropic/claude-sonnet-4.5'].provider?.api).toBe(
      'https://gateway.ai.cloudflare.com/v1/acct/gw/anthropic/v1'
    );
    expect(gateway.models['workers-ai/@cf/meta/llama'].id).toBe(
      '@cf/meta/llama'
    );
  });

  test('Cloudflare passthrough requests authenticate with cf-aig-authorization only', async () => {
    const seen: Headers[] = [];
    const inner = (async (_: any, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return new Response('{}');
    }) as unknown as typeof fetch;
    const wrapped = ParityLoaders.cloudflareGatewayFetch('tok', inner);
    const headers = {
      authorization: 'Bearer tok',
      'cf-aig-gateway-id': 'gw',
    };
    await wrapped(
      'https://gateway.ai.cloudflare.com/v1/a/gw/openai/responses',
      {
        headers,
      }
    );
    await wrapped('https://api.cloudflare.com/client/v4/accounts/a/ai/v1', {
      headers,
    });
    expect(seen[0].get('authorization')).toBeNull();
    expect(seen[0].get('cf-aig-gateway-id')).toBeNull();
    expect(seen[0].get('cf-aig-authorization')).toBe('Bearer tok');
    expect(seen[1].get('authorization')).toBe('Bearer tok');
    expect(seen[1].get('cf-aig-gateway-id')).toBe('gw');
  });

  test('Snowflake: max_completion_tokens and "conversation complete" stop', async () => {
    let body: any;
    const inner = (async (_: any, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return Response.json(
        { message: 'Conversation complete.' },
        { status: 400 }
      );
    }) as unknown as typeof fetch;
    const response = await ParityLoaders.snowflakeFetch(inner)('https://x', {
      method: 'POST',
      body: JSON.stringify({ max_tokens: 10 }),
    });
    expect(body).toEqual({ max_completion_tokens: 10 });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"finish_reason":"stop"');
  });

  test('Vertex partner requests get an ADC token, real credentials are kept', async () => {
    const seen: Array<string | null> = [];
    const inner = (async (_: any, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get('authorization'));
      return new Response('{}');
    }) as unknown as typeof fetch;
    const wrapped = ParityLoaders.vertexFetch(inner, async () => 'adc-token');
    const url =
      'https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/us-central1/endpoints/openapi/chat/completions';
    await wrapped(url, {
      headers: {
        authorization: `Bearer ${ParityLoaders.VERTEX_ADC_PLACEHOLDER}`,
      },
    });
    await wrapped(url, { headers: { authorization: 'Bearer real' } });
    await wrapped('https://example.com/v1', {
      headers: { authorization: 'Bearer other' },
    });
    expect(seen).toEqual(['Bearer adc-token', 'Bearer real', 'Bearer other']);
  });

  test('Vertex loader adapts options per SDK package', async () => {
    const loaders = ParityLoaders.create({
      GOOGLE_VERTEX_PROJECT: 'proj',
      GOOGLE_VERTEX_API_KEY: 'express',
    });
    const result = await loaders['google-vertex'](undefined);
    expect(result.autoload).toBe(true);
    const options = { ...result.options };
    const sdkOptions = result.sdkOptions!;
    expect(sdkOptions('@ai-sdk/google-vertex', options).apiKey).toBe('express');
    expect(
      sdkOptions('@ai-sdk/google-vertex/anthropic', options).apiKey
    ).toBeUndefined();
    const partner = sdkOptions('@ai-sdk/openai-compatible', options);
    expect(partner.apiKey).toBe(ParityLoaders.VERTEX_ADC_PLACEHOLDER);
    expect(partner.project).toBeUndefined();
  });

  test('loaders autoload only with the credentials they need', async () => {
    const none = ParityLoaders.create({});
    expect((await none['amazon-bedrock'](undefined)).autoload).toBe(false);
    expect((await none['google-vertex'](undefined)).autoload).toBe(false);
    expect((await none['cloudflare-ai-gateway'](undefined)).autoload).toBe(
      false
    );
    expect((await none['sap-ai-core'](undefined)).autoload).toBe(false);
    const workers = await ParityLoaders.create({
      CLOUDFLARE_ACCOUNT_ID: 'acct',
      CLOUDFLARE_API_TOKEN: 'tok',
    })['cloudflare-workers-ai'](undefined);
    expect(workers.autoload).toBe(true);
    expect(workers.options?.apiKey).toBe('tok');
    const nvidia = await ParityLoaders.create({}).nvidia({
      id: 'nvidia',
      name: 'Nvidia',
      api: ParityLoaders.NVIDIA_URL,
      env: [],
      models: {},
    });
    expect(nvidia.options?.headers['X-BILLING-INVOKE-ORIGIN']).toBe('OpenCode');
  });

  test('Bedrock cross-region inference profile prefixes', () => {
    const id = 'anthropic.claude-sonnet-4-5-v1:0';
    expect(ParityLoaders.bedrockModelID(id, 'us-east-1')).toBe(`us.${id}`);
    expect(ParityLoaders.bedrockModelID(id, 'us-gov-west-1')).toBe(id);
    expect(ParityLoaders.bedrockModelID(id, 'eu-west-1')).toBe(`eu.${id}`);
    expect(ParityLoaders.bedrockModelID(id, 'ap-southeast-2')).toBe(`au.${id}`);
    expect(ParityLoaders.bedrockModelID(id, 'ap-northeast-1')).toBe(
      `apac.${id}`
    );
    expect(ParityLoaders.bedrockModelID('openai.gpt-oss', 'us-east-1')).toBe(
      'openai.gpt-oss'
    );
  });

  test('API shape selects chat or responses', () => {
    const sdk = {
      chat: (id: string) => `chat:${id}`,
      responses: (id: string) => `responses:${id}`,
    };
    const mantle = { npm: ParityLoaders.BEDROCK_MANTLE_NPM };
    expect(
      ParityLoaders.selectByShape(
        sdk,
        model('openai.gpt-oss-120b', { provider: mantle }),
        'openai.gpt-oss-120b'
      )
    ).toBe('chat:openai.gpt-oss-120b');
    expect(
      ParityLoaders.selectByShape(
        sdk,
        model('openai.gpt-5', { provider: mantle }),
        'openai.gpt-5'
      )
    ).toBe('responses:openai.gpt-5');
    expect(
      ParityLoaders.selectByShape(
        sdk,
        model('x', { provider: { shape: 'completions' } }),
        'x'
      )
    ).toBe('chat:x');
    expect(ParityLoaders.selectByShape(sdk, model('x'), 'x')).toBeUndefined();
  });
});

describe('Kilo catalogue (#334)', () => {
  test('keeps text models and drops the catalogue route override', () => {
    const models = Kilo.catalogueModels({
      id: 'kilo',
      name: 'Kilo',
      env: [],
      models: {
        'a/text': model('a/text', {
          provider: { api: 'https://api.kilo.ai/api/gateway' },
        }),
        'a/image': model('a/image', {
          modalities: { input: ['text'], output: ['image'] },
        }),
      },
    });
    expect(Object.keys(models)).toEqual(['a/text']);
    expect(models['a/text'].provider).toBeUndefined();
  });
});

describe('provider registry end to end (#334)', async () => {
  const proc = Bun.spawn({
    cmd: ['bun', '../experiments/issue-334/probe-registry.ts'],
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      LINK_ASSISTANT_AGENT_CONFIG_CONTENT: '{}',
      GOOGLE_VERTEX_PROJECT: 'proj',
      GOOGLE_VERTEX_LOCATION: 'us-central1',
      CLOUDFLARE_ACCOUNT_ID: 'acct',
      CLOUDFLARE_API_TOKEN: 'cf-token',
      AWS_BEARER_TOKEN_BEDROCK: 'bedrock-token',
      AWS_REGION: 'us-west-2',
      SNOWFLAKE_ACCOUNT: 'https://abc.snowflakecomputing.com/',
      SNOWFLAKE_CORTEX_PAT: 'pat',
      DATABRICKS_TOKEN: 'dbx',
      DATABRICKS_HOST: '',
    },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0)
    throw new Error(`registry probe failed: ${stdout}\n${stderr}`);
  const result = JSON.parse(
    stdout
      .split('\n')
      .find((line) => line.startsWith('RESULT '))!
      .slice(7)
  );

  test('keyless providers stay out of default resolution until requested', () => {
    expect(result.providersBefore).not.toContain('gpt4free');
    expect(result.providersBefore).not.toContain('pollinations');
  });

  test('g4f alias reaches the gpt4free server and returns its answer', () => {
    expect(result.g4f.providerID).toBe('gpt4free');
    expect(result.g4fReply).toBe('echo:Mock-Model');
    expect(result.chatModels).toEqual(['Mock-Model']);
    // One listing request, then served from cache.
    expect(
      result.requests.filter((r: string) => r === 'GET /v1/models')
    ).toHaveLength(1);
  });

  test('discovered models carry the server limits; unlisted IDs pass through', () => {
    expect(result.discovered.id).toBe('Mock-Model');
    expect(result.discovered.limit).toEqual({ context: 1234, output: 321 });
    expect(result.passthrough.modelId).toBe('gpt-4o-mini');
  });

  test('Vertex partner models use their OpenAI-compatible endpoint', () => {
    expect(result.vertexActive).toBe(true);
    expect(result.vertexOpenapi.url).toStartWith(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/proj/locations/us-central1/endpoints/openapi/'
    );
  });

  test('Cloudflare AI Gateway uses Responses/Messages passthrough routes', () => {
    expect(result.cloudflareActive).toBe(true);
    expect(result['cloudflare:openai/'].provider).toEndWith('.responses');
    expect(result['cloudflare:openai/'].url).toStartWith(
      'https://gateway.ai.cloudflare.com/v1/acct/default/openai/'
    );
    expect(result['cloudflare:anthropic/'].modelId).not.toContain('.');
    expect(result['cloudflare:anthropic/'].baseURL).toBe(
      'https://gateway.ai.cloudflare.com/v1/acct/default/anthropic/v1'
    );
  });

  test('Bedrock Mantle picks chat for gpt-oss and responses otherwise', () => {
    expect(result.bedrockActive).toBe(true);
    expect(result.mantleOss.provider).toBe('bedrock-mantle.chat');
    expect(result.mantleOss.url).toStartWith(
      'https://bedrock-mantle.us-west-2.api.aws/'
    );
    expect(result.mantleOther.provider).toBe('bedrock-mantle.responses');
  });

  test('templated base URLs resolve, or fail naming the missing variable', () => {
    expect(result.snowflakeBaseURL).toBe(
      'https://abc.snowflakecomputing.com/api/v2/cortex/v1'
    );
    expect(result.databricks.ok).toBe(false);
    expect(result.databricks.error).toContain('DATABRICKS_HOST');
  });
});
