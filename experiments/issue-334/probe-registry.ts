// Probe for #334: drives the real provider registry against a local mock
// OpenAI-compatible server (standing in for the gpt4free Interference API)
// and inspects how catalogue providers are routed. No paid API is called.
//
// Usage: bun experiments/issue-334/probe-registry.ts
// Prints one `RESULT <json>` line.
// Resolve `ai` from the js package so the same SDK copy is used.
const { generateText } = await import(
  Bun.resolveSync('ai', `${import.meta.dir}/../../js/src`)
);

const requests: Array<{ method: string; path: string; body?: any }> = [];
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const body = req.method === 'POST' ? await req.json() : undefined;
    requests.push({ method: req.method, path: url.pathname, body });
    if (url.pathname === '/v1/models') {
      return Response.json({
        object: 'list',
        data: [
          { id: 'Mock-Model', context_length: 1234, max_tokens: 321 },
          { id: 'flux', image: true },
        ],
      });
    }
    if (url.pathname === '/v1/chat/completions') {
      return Response.json({
        id: 'chatcmpl-1',
        object: 'chat.completion',
        created: 0,
        model: body?.model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: `echo:${body?.model}` },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    }
    return new Response('not found', { status: 404 });
  },
});

process.env.G4F_BASE_URL = `http://127.0.0.1:${server.port}/v1`;

const { Instance } = await import('../../js/src/project/instance');
const { Provider } = await import('../../js/src/provider/provider');

function describe(language: any) {
  const config = language?.config ?? {};
  let url: string | undefined;
  try {
    url = config.url?.({
      path: '/chat/completions',
      modelId: language.modelId,
    });
  } catch {
    url = undefined;
  }
  return {
    provider: language?.provider,
    modelId: language?.modelId,
    url,
    baseURL: config.baseURL,
  };
}

async function attempt<T>(fn: () => Promise<T>) {
  try {
    return { ok: true as const, value: await fn() };
  } catch (error: any) {
    const messages: string[] = [];
    for (let e = error; e; e = e.cause) {
      messages.push(String(e.data?.message ?? e.message ?? e));
    }
    return { ok: false as const, error: messages.join(' <- ') };
  }
}

const result: Record<string, any> = {};

await Instance.provide({
  directory: process.cwd(),
  fn: async () => {
    const s = await Provider.state();
    result.providersBefore = Object.keys(s.providers).sort();
    result.kiloModelCount = Object.keys(
      s.providers['kilo']?.info.models ?? {}
    ).length;

    // gpt4free: enabled on explicit use through an alias, served model.
    const g4f = await Provider.getModel('g4f', 'Mock-Model');
    result.g4f = { providerID: g4f.providerID, ...describe(g4f.language) };
    const reply = await generateText({ model: g4f.language, prompt: 'hi' });
    result.g4fReply = reply.text;

    // Discovered metadata, case-insensitive match keeps the served ID.
    const discovered = await Provider.getModel('gpt4free', 'mock-model');
    result.discovered = {
      id: discovered.info.id,
      limit: discovered.info.limit,
      ...describe(discovered.language),
    };

    // Unlisted ID on a router: passed through unchanged.
    const passthrough = await Provider.getModel('gpt4free', 'gpt-4o-mini');
    result.passthrough = {
      id: passthrough.info.id,
      ...describe(passthrough.language),
    };
    result.requests = requests.map((r) => `${r.method} ${r.path}`);
    result.chatModels = requests
      .filter((r) => r.path === '/v1/chat/completions')
      .map((r) => r.body?.model);

    // Vertex partner model through its OpenAI-compatible endpoint.
    const vertex = s.database['google-vertex'];
    const openapi = Object.entries(vertex?.models ?? {}).find(
      ([, m]) => m.provider?.npm === '@ai-sdk/openai-compatible'
    );
    result.vertexActive = Boolean(s.providers['google-vertex']);
    if (openapi) {
      const model = await Provider.getModel('google-vertex', openapi[0]);
      result.vertexOpenapi = describe(model.language);
    }

    // Cloudflare AI Gateway routes per model family.
    const gateway = s.providers['cloudflare-ai-gateway'];
    result.cloudflareActive = Boolean(gateway);
    const pick = (prefix: string) =>
      Object.keys(gateway?.info.models ?? {}).find((k) => k.startsWith(prefix));
    for (const prefix of ['openai/', 'anthropic/', 'workers-ai/']) {
      const key = pick(prefix);
      if (!key) continue;
      const model = await Provider.getModel('cloudflare-ai-gateway', key);
      result[`cloudflare:${prefix}`] = { key, ...describe(model.language) };
    }

    // Bedrock Mantle: gpt-oss uses Chat Completions, others Responses.
    const bedrock = s.providers['amazon-bedrock'];
    result.bedrockActive = Boolean(bedrock);
    const mantle = Object.entries(bedrock?.info.models ?? {}).filter(
      ([, m]) => m.provider?.npm === '@ai-sdk/amazon-bedrock/mantle'
    );
    const oss = mantle.find(([k]) => k.includes('gpt-oss'));
    const other = mantle.find(([k]) => !k.includes('gpt-oss'));
    if (oss) {
      const model = await Provider.getModel('amazon-bedrock', oss[0]);
      result.mantleOss = describe(model.language);
    }
    if (other) {
      const model = await Provider.getModel('amazon-bedrock', other[0]);
      result.mantleOther = { key: other[0], ...describe(model.language) };
    }

    // Snowflake account normalisation fills the templated base URL.
    result.snowflakeBaseURL =
      s.providers['snowflake-cortex']?.options.baseURL ?? null;

    // Databricks has a key but no host: a clear error names the variable.
    const databricks = Object.keys(
      s.providers['databricks']?.info.models ?? {}
    )[0];
    if (databricks) {
      result.databricks = await attempt(() =>
        Provider.getModel('databricks', databricks)
      );
    }
  },
});

server.stop(true);
console.log(`RESULT ${JSON.stringify(result)}`);
process.exit(0);
