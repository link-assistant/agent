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
 * Round 3: all three stdin delivery methods (closed Uint8Array, shell pipe and
 *          `-p`, which bypasses stdin entirely) stall identically, so stdin is
 *          not the ingredient. Every run stops inside the global config
 *          `loadFile` sequence.
 * Round 4 (this one): is the process deadlocking, or is the event loop simply
 *          draining while a promise is pending? Import the CLI entry point
 *          under a ref'd timer that keeps the loop alive and see whether the
 *          turn completes.
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

const KEEP_ALIVE_SCRIPT = `
  const t0 = Date.now();
  const mark = (m) => console.log('PH ' + m + ' t=' + (Date.now() - t0));
  process.on('exit', (code) => mark('exit code=' + code));

  // Keep the event loop busy for 20s: if the CLI only stalls because nothing
  // holds the loop open, this makes the turn run to completion.
  const tick = setInterval(() => mark('tick'), 1000);
  const giveUp = setTimeout(() => {
    mark('giving-up');
    process.exit(7);
  }, 20000);

  process.argv = [process.argv[0], 'src/index.js', ...JSON.parse(process.env.PROBE_CLI_ARGS)];
  mark('importing-cli');
  await import('./src/index.js');
  mark('cli-imported');
`;

describe('windows CLI keep-alive probe (temporary, #304)', () => {
  test('probe H: CLI entry point under a ref\'d keep-alive timer', async () => {
    const provider = await startCooperativeProvider();
    try {
      const proc = Bun.spawn({
        cmd: ['bun', '--eval', KEEP_ALIVE_SCRIPT],
        cwd: process.cwd(),
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...process.env,
          PROBE_CLI_ARGS: JSON.stringify([
            '--model',
            'formalai/formal-ai',
            '--no-server',
            '--output-format',
            'stream-json',
            '--disable-stdin',
            '-p',
            'say hi',
          ]),
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
        `PROBE_H platform=${process.platform} exit=${exitCode} requests=${JSON.stringify(
          provider.requests
        )} hasResult=${stdout.includes('"type":"result"')}\nmarks:\n${stdout
          .split('\n')
          .filter((line) => line.startsWith('PH '))
          .join('\n')}\nstdout tail:\n${stdout.slice(
          -1500
        )}\nstderr tail:\n${stderr.slice(-1500)}\nPROBE_H_END`
      );
    } finally {
      await provider.close();
    }
    expect(true).toBe(true);
  });
});
