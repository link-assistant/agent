import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Session summarization must never decide the exit status of a run.
 *
 * Summarization is a side quest whose whole product is a session title, a body
 * and a diff stat. It is on by default, it runs concurrently with the turn, and
 * neither of its two call sites awaits it. A rejection from it therefore has no
 * handler anywhere and surfaces as `unhandledRejection`, which the CLI turns
 * into exit 1 — aborting a turn that was still streaming and emitting no
 * `result` event at all.
 *
 * Two levels of coverage:
 *   1. `SessionSummary.summarize` resolves even when its own work throws.
 *   2. End to end: a provider that answers the streaming turn but refuses the
 *      non-streaming summary request still yields exit 0 and a `result` event.
 *
 * @see https://github.com/link-assistant/agent/issues/304
 */

setDefaultTimeout(60000);

describe('SessionSummary.summarize (#304)', () => {
  test('resolves instead of rejecting when the summary work throws', async () => {
    // A session id that was never written makes `summarizeMessage` dereference
    // a message it cannot find — the cheapest deterministic way to make the
    // body of `summarize` throw without a provider or a network.
    const script = `
      import { Instance } from './src/project/instance.ts';
      import { SessionSummary } from './src/session/summary.ts';

      process.on('unhandledRejection', (reason) => {
        console.log('RESULT ' + JSON.stringify({ outcome: 'unhandled', error: String(reason) }));
        process.exit(1);
      });

      await Instance.provide({
        directory: process.cwd(),
        fn: async () => {
          const outcome = await SessionSummary.summarize({
            sessionID: 'ses_missing0000000000000000',
            messageID: 'msg_missing0000000000000000',
          }).then(
            () => 'resolved',
            (error) => 'rejected: ' + error
          );
          console.log('RESULT ' + JSON.stringify({ outcome }));
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
        LINK_ASSISTANT_AGENT_CONFIG_CONTENT: '{}',
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
    expect(resultLine, `stdout:\n${stdout}\nstderr:\n${stderr}`).toBeDefined();
    expect(JSON.parse(resultLine!.slice('RESULT '.length)).outcome).toBe(
      'resolved'
    );
    expect(exitCode).toBe(0);
  });
});

/**
 * A provider that answers the streaming request (the turn) and refuses the
 * non-streaming one (the summary) with HTTP 400.
 *
 * The status code and the delay are both load-bearing: a 4xx is not retried, so
 * the rejection lands promptly, and holding the stream open keeps the turn in
 * flight when it does — which is the race the bug loses.
 */
async function startRefusingSummaryProvider(streamDelayMs: number) {
  const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
  const summaryRequests: number[] = [];

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
        summaryRequests.push(Date.now());
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({ error: { message: 'mock summary failure' } })
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
      setTimeout(() => {
        response.write(chunk({}, 'stop', { usage }));
        response.write('data: [DONE]\n\n');
        response.end();
      }, streamDelayMs);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const { port } = server.address() as AddressInfo;

  return {
    summaryRequests,
    baseURL: `http://127.0.0.1:${port}/v1`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

describe('a refused session summary does not fail the run (#304)', () => {
  test('the CLI exits 0, keeps streaming and still reports a result', async () => {
    const provider = await startRefusingSummaryProvider(2000);
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

      const events = stdout
        .split('\n')
        .filter((line) => line.trim().startsWith('{'))
        .map((line) => {
          try {
            return JSON.parse(line) as Record<string, any>;
          } catch {
            return null;
          }
        })
        .filter((event): event is Record<string, any> => event !== null);

      const context = `exit=${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`;

      // The summary really was attempted and really was refused.
      expect(provider.summaryRequests.length, context).toBeGreaterThan(0);

      // …and none of that reached the process-level handler.
      expect(stderr, context).not.toContain('UnhandledRejection');

      const result = events.find((event) => event.type === 'result');
      expect(result, context).toBeDefined();
      expect(result!.status, context).toBe('success');
      expect(exitCode, context).toBe(0);

      // The failure is reported, not swallowed silently.
      const warning = events.find(
        (event) =>
          event.type === 'log' &&
          event.level === 'warn' &&
          event.service === 'session.summary'
      );
      expect(warning, context).toBeDefined();
    } finally {
      await provider.close();
    }
  });
});
