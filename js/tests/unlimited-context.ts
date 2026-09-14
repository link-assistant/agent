import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ModelsDev } from '../src/provider/models';
import { SessionCompaction } from '../src/session/compaction';

/**
 * A model can declare that it has no context window to run out of.
 *
 * Compaction and session summarization both exist to keep a conversation
 * inside a context window. For a model without one they have nothing to do,
 * yet they still cost an API call per turn — which an integrator could only
 * avoid by passing `--no-summarize-session` on every run. Declaring the
 * capability once, in the provider config, turns both off:
 *
 *   { "provider": { "formalai": { "models": {
 *       "formal-ai": { "limit": { "context": null } } } } } }
 *
 * `"unlimited": true` is the equivalent spelling.
 *
 * @see https://github.com/link-assistant/agent/issues/307
 */

setDefaultTimeout(60000);

function model(overrides: Partial<ModelsDev.Model>): ModelsDev.Model {
  return {
    id: 'formal-ai',
    name: 'Formal AI',
    release_date: '2026-07-03',
    attachment: false,
    reasoning: false,
    temperature: true,
    tool_call: true,
    cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
    limit: { context: 60_000, output: 8_192 },
    options: {},
    ...overrides,
  };
}

const tokens = {
  input: 10_000_000,
  output: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 },
};

describe('unlimited context capability (#307)', () => {
  test('hasUnlimitedContext reads the declared capability, not the numbers', () => {
    expect(ModelsDev.hasUnlimitedContext(model({ unlimited: true }))).toBe(
      true
    );
    expect(ModelsDev.hasUnlimitedContext(model({}))).toBe(false);
    // A context limit of 0 means "unknown", which is not a claim of being
    // unlimited — it must not silently disable summarization.
    expect(
      ModelsDev.hasUnlimitedContext(model({ limit: { context: 0, output: 0 } }))
    ).toBe(false);
    expect(ModelsDev.hasUnlimitedContext(undefined)).toBe(false);
  });

  test('an unlimited model never overflows, however many tokens it holds', () => {
    expect(SessionCompaction.isOverflow({ tokens, model: model({}) })).toBe(
      true
    );
    expect(
      SessionCompaction.isOverflow({
        tokens,
        model: model({ unlimited: true }),
      })
    ).toBe(false);
  });

  test('an unlimited model reports no context diagnostics', () => {
    const usage = { input: 10_000_000, output: 0, cache: { read: 0 } };
    expect(
      SessionCompaction.contextDiagnostics({ tokens: usage, model: model({}) })
    ).toBeDefined();
    expect(
      SessionCompaction.contextDiagnostics({
        tokens: usage,
        model: model({ unlimited: true }),
      })
    ).toBeUndefined();
  });
});

/** Read back how the config merge understood a model override. */
async function resolveModelInfo(configContent: string) {
  const script = `
    import { initConfig, resetConfig } from './src/config/config.ts';
    import { Instance } from './src/project/instance.ts';
    import { Provider } from './src/provider/provider.ts';
    import { ModelsDev } from './src/provider/models.ts';

    process.argv = ['bun', 'agent', '--model', 'formalai/formal-ai'];
    resetConfig();
    initConfig(process.argv);

    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const model = await Provider.getModel('formalai', 'formal-ai');
        console.log(
          'RESULT ' +
            JSON.stringify({
              context: model.info.limit.context,
              output: model.info.limit.output,
              unlimited: ModelsDev.hasUnlimitedContext(model.info),
            })
        );
      },
    });

    await Instance.disposeAll();
  `;

  const proc = Bun.spawn({
    cmd: ['bun', '--eval', script],
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      FORMAL_AI_API_KEY: 'local-test-token',
      FORMAL_AI_BASE_URL: 'http://127.0.0.1:18080/api/openai/v1',
      LINK_ASSISTANT_AGENT_CONFIG_CONTENT: configContent,
    },
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  const resultLine = stdout
    .split('\n')
    .find((line) => line.startsWith('RESULT '));
  if (!resultLine) {
    throw new Error(
      `provider merge child failed (exit ${exitCode})\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`
    );
  }
  return JSON.parse(resultLine.slice('RESULT '.length));
}

const unlimitedConfig = (model: Record<string, unknown>) =>
  JSON.stringify({
    provider: { formalai: { models: { 'formal-ai': model } } },
  });

describe('declaring an unlimited model in the config (#307)', () => {
  test('`limit.context: null` becomes the unlimited capability', async () => {
    const info = await resolveModelInfo(
      unlimitedConfig({ limit: { context: null } })
    );

    expect(info.unlimited).toBe(true);
    // The other limits survive the override.
    expect(info.output).toBe(8192);
  });

  test('`unlimited: true` says the same thing', async () => {
    const info = await resolveModelInfo(unlimitedConfig({ unlimited: true }));

    expect(info.unlimited).toBe(true);
  });

  test('a model without the capability keeps its context limit', async () => {
    const info = await resolveModelInfo('{}');

    expect(info.unlimited).toBe(false);
    expect(info.context).toBeGreaterThan(0);
  });
});

/**
 * A provider that streams the turn and records every non-streaming request —
 * those are the summary calls this feature is supposed to stop making.
 */
async function startCountingProvider() {
  const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
  const secondaryRequests: string[] = [];

  const server = createServer((request, response) => {
    if (request.url?.includes('/models')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ object: 'list', data: [{ id: 'formal-ai' }] })
      );
      return;
    }

    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      let parsed: { stream?: boolean } = {};
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = {};
      }

      if (!parsed.stream) {
        secondaryRequests.push(body);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            id: 'chatcmpl-fake',
            object: 'chat.completion',
            created: 0,
            model: 'formal-ai',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'a title' },
                finish_reason: 'stop',
              },
            ],
            usage,
          })
        );
        return;
      }

      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = (
        delta: Record<string, unknown>,
        finishReason: string | null = null,
        extra: Record<string, unknown> = {}
      ) =>
        `data: ${JSON.stringify({
          id: 'chatcmpl-fake',
          object: 'chat.completion.chunk',
          created: 0,
          model: 'formal-ai',
          choices: [{ index: 0, delta, finish_reason: finishReason }],
          ...extra,
        })}\n\n`;

      response.write(chunk({ role: 'assistant', content: 'hi' }));
      response.write(chunk({}, 'stop', { usage }));
      response.write('data: [DONE]\n\n');
      response.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const { port } = server.address() as AddressInfo;

  return {
    secondaryRequests,
    baseURL: `http://127.0.0.1:${port}/v1`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function runTurn(configContent: string) {
  const provider = await startCountingProvider();
  try {
    const proc = Bun.spawn({
      cmd: [
        'bun',
        'run',
        'src/index.js',
        '--model',
        'formalai/formal-ai',
        '--no-always-accept-stdin',
        '--no-server',
        '--output-format',
        'stream-json',
      ],
      cwd: process.cwd(),
      stdin: new TextEncoder().encode('say hi\n'),
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        LINK_ASSISTANT_AGENT_COMPACT_JSON: '1',
        LINK_ASSISTANT_AGENT_CONFIG_CONTENT: configContent,
        FORMAL_AI_API_KEY: 'local-test-token',
        FORMAL_AI_BASE_URL: provider.baseURL,
      },
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    return {
      secondaryRequests: provider.secondaryRequests,
      exitCode,
      context: `exit=${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      events: stdout
        .split('\n')
        .filter((line) => line.trim().startsWith('{'))
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as Record<string, any>];
          } catch {
            return [];
          }
        }),
    };
  } finally {
    await provider.close();
  }
}

describe('an unlimited model makes no secondary calls (#307)', () => {
  test('a limited model still summarizes — and an unlimited one does not', async () => {
    const limited = await runTurn('{}');
    expect(limited.exitCode, limited.context).toBe(0);
    // Control: without the capability the summary call really does happen,
    // so its absence below means something.
    expect(limited.secondaryRequests.length, limited.context).toBeGreaterThan(
      0
    );

    const unlimited = await runTurn(
      unlimitedConfig({ limit: { context: null } })
    );
    expect(unlimited.exitCode, unlimited.context).toBe(0);
    expect(unlimited.secondaryRequests, unlimited.context).toEqual([]);

    const result = unlimited.events.find((event) => event.type === 'result');
    expect(result, unlimited.context).toBeDefined();
    expect(result!.status, unlimited.context).toBe('success');
  });
});
