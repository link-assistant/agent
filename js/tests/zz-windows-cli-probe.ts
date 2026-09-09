/**
 * TEMPORARY diagnostic probe for the Windows-only stall of the CLI turn
 * (surfaced by tests/session-summary-failure.ts, issue #304). Always passes; it
 * only prints how far the CLI gets on each platform. Delete once the root cause
 * is known.
 *
 * Round 1: with a cooperative fake provider the CLI exits 0 within ~60ms of the
 *          first config "loading" log and never reaches the provider.
 * Round 2: driving the same startup path directly (`bun --eval`) works on
 *          Windows — Config.get, ModelsDev.get and Provider.state all settle in
 *          under half a second. So the stall needs the CLI entry point, whose
 *          one extra ingredient is stdin.
 * Round 3 (this one): compare stdin delivery methods — a closed Uint8Array
 *          stdin (what the failing test does), a shell pipe, and `-p` which
 *          bypasses stdin entirely.
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

const CLI_ARGS = [
  'src/index.js',
  '--model',
  'formalai/formal-ai',
  '--no-server',
  '--output-format',
  'stream-json',
];

async function probe(
  label: string,
  build: (baseURL: string) => {
    cmd: string[];
    stdin?: Uint8Array;
  }
) {
  const provider = await startCooperativeProvider();
  try {
    const spec = build(provider.baseURL);
    const proc = Bun.spawn({
      cmd: spec.cmd,
      cwd: process.cwd(),
      ...(spec.stdin ? { stdin: spec.stdin } : {}),
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
    const hasResult = stdout.includes('"type":"result"');
    console.log(
      `${label} platform=${process.platform} exit=${exitCode} requests=${JSON.stringify(
        provider.requests
      )} hasResult=${hasResult}\nstdout tail:\n${stdout.slice(
        -1200
      )}\nstderr tail:\n${stderr.slice(-1200)}\n${label}_END`
    );
  } finally {
    await provider.close();
  }
}

describe('windows CLI stdin probe (temporary, #304)', () => {
  test('probe E: closed Uint8Array stdin', async () => {
    await probe('PROBE_E', () => ({
      cmd: ['bun', 'run', ...CLI_ARGS, '--no-always-accept-stdin'],
      stdin: new TextEncoder().encode('say hi\n'),
    }));
    expect(true).toBe(true);
  });

  test('probe F: -p bypasses stdin', async () => {
    await probe('PROBE_F', () => ({
      cmd: ['bun', 'run', ...CLI_ARGS, '--disable-stdin', '-p', 'say hi'],
    }));
    expect(true).toBe(true);
  });

  test('probe G: shell pipe into stdin', async () => {
    await probe('PROBE_G', () => ({
      cmd: [
        'bash',
        '-c',
        `echo "say hi" | bun run ${CLI_ARGS.map((a) => `'${a}'`).join(
          ' '
        )} --no-always-accept-stdin`,
      ],
    }));
    expect(true).toBe(true);
  });
});
