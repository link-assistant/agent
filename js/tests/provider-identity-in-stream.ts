import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * With an explicit `--model` and every auxiliary call switched off, the only
 * provider the run talks to is the one named in `--model`. The event stream
 * must say so: an integrator that grades provenance by looking for
 * `providerID` fields must not find candidates the agent merely enumerated
 * (the provider registry, the built-in compaction cascade) and never called.
 *
 * @see https://github.com/link-assistant/agent/issues/313
 * @see https://github.com/link-assistant/agent/issues/315
 */

setDefaultTimeout(60000);

async function startFormalAi() {
  const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
  const server = createServer((request, response) => {
    if (request.url?.includes('/models')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ object: 'list', data: [{ id: 'formal-ai' }] })
      );
      return;
    }
    request.resume();
    request.on('end', () => {
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
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(chunk({ role: 'assistant', content: 'hi' }));
      response.write(chunk({}, 'stop', { usage }));
      response.end('data: [DONE]\n\n');
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;

  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

/** Every `providerID` / `modelID` value in a record, at any depth. */
function identities(value: unknown, path = ''): Array<[string, string]> {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) =>
    (key === 'providerID' || key === 'modelID') && typeof child === 'string'
      ? [[`${path}${key}`, child] as [string, string]]
      : identities(child, `${path}${key}.`)
  );
}

async function runTurn() {
  const provider = await startFormalAi();
  try {
    const proc = Bun.spawn({
      cmd: [
        'bun',
        'run',
        'src/index.js',
        '--model',
        'formalai/formal-ai',
        '--no-summarize-session',
        '--no-generate-title',
        '--verbose',
        '--no-always-accept-stdin',
        '--no-server',
      ],
      cwd: process.cwd(),
      stdin: new TextEncoder().encode('say hi\n'),
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        LINK_ASSISTANT_AGENT_COMPACT_JSON: '1',
        LINK_ASSISTANT_AGENT_CONFIG_CONTENT: '{}',
        FORMAL_AI_API_KEY: 'local-test-token',
        FORMAL_AI_BASE_URL: provider.baseURL,
      },
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const records = `${stdout}\n${stderr}`
      .split('\n')
      .filter((line) => line.trim().startsWith('{'))
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as Record<string, any>];
        } catch {
          return [];
        }
      });

    return {
      exitCode,
      records,
      context: `exit=${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    };
  } finally {
    await provider.close();
  }
}

describe('provider identity in the stream (#313)', () => {
  test('an explicit --model with auxiliary calls off names no other provider', async () => {
    const run = await runTurn();
    expect(run.exitCode, run.context).toBe(0);

    const named = run.records.filter((record) => identities(record).length > 0);
    // Control: the provider that did serve the turn is still reported.
    expect(named.length, run.context).toBeGreaterThan(0);

    const foreign = named
      .map((record) => ({
        service: record.service,
        message: record.message,
        providers: identities(record)
          .filter(([key]) => key.endsWith('providerID'))
          .map(([, value]) => value)
          .filter((value) => value !== 'formalai'),
      }))
      .filter((record) => record.providers.length > 0);
    expect(foreign).toEqual([]);

    // Models nobody asked for are not looked up, so they cannot fail to be
    // found either.
    const notFound = run.records.filter((record) =>
      JSON.stringify(record).includes('ProviderModelNotFoundError')
    );
    expect(notFound).toEqual([]);
  });
});
