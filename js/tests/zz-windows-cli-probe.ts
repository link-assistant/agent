/**
 * TEMPORARY diagnostic probe for the Windows-only failure of
 * tests/session-summary-failure.ts (issue #304). Always passes; it only prints
 * what the CLI does on each platform so the CI log can be read. Delete once the
 * root cause is known.
 */
import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

setDefaultTimeout(60000);

async function startCooperativeProvider() {
  const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
  const requests: string[] = [];
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
      requests.push(parsed.stream ? 'stream' : 'non-stream');
      if (!parsed.stream) {
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
                message: { role: 'assistant', content: 'summary' },
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
    requests,
    baseURL: `http://127.0.0.1:${port}/v1`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

describe('windows CLI probe (temporary, #304)', () => {
  test('probe A: --version', async () => {
    const proc = Bun.spawn({
      cmd: ['bun', 'run', 'src/index.js', '--version'],
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, LINK_ASSISTANT_AGENT_CONFIG_CONTENT: '{}' },
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    console.log(
      `PROBE_A platform=${process.platform} exit=${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}\nPROBE_A_END`
    );
    expect(true).toBe(true);
  });

  test('probe B: cooperative provider, plain turn', async () => {
    const provider = await startCooperativeProvider();
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
          LINK_ASSISTANT_AGENT_CONFIG_CONTENT: '{}',
          LINK_ASSISTANT_AGENT_DEFAULT_COMPACTION_MODELS: '(same)',
          FORMAL_AI_API_KEY: 'local-test-token',
          FORMAL_AI_BASE_URL: provider.baseURL,
        },
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      console.log(
        `PROBE_B platform=${process.platform} exit=${exitCode} requests=${JSON.stringify(
          provider.requests
        )}\nstdout:\n${stdout}\nstderr:\n${stderr}\nPROBE_B_END`
      );
    } finally {
      await provider.close();
    }
    expect(true).toBe(true);
  });

  test('probe C: cooperative provider, verbose', async () => {
    const provider = await startCooperativeProvider();
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
          '--verbose',
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
          LINK_ASSISTANT_AGENT_CONFIG_CONTENT: '{}',
          LINK_ASSISTANT_AGENT_DEFAULT_COMPACTION_MODELS: '(same)',
          FORMAL_AI_API_KEY: 'local-test-token',
          FORMAL_AI_BASE_URL: provider.baseURL,
        },
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      console.log(
        `PROBE_C platform=${process.platform} exit=${exitCode} requests=${JSON.stringify(
          provider.requests
        )}\nstdout tail:\n${stdout.slice(-4000)}\nstderr tail:\n${stderr.slice(
          -4000
        )}\nPROBE_C_END`
      );
    } finally {
      await provider.close();
    }
    expect(true).toBe(true);
  });
});
