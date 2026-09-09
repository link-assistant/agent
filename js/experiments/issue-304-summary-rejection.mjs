#!/usr/bin/env bun
/**
 * Reproduction for #304: a failed session summary is an unhandled rejection.
 *
 * The fake provider answers the *streaming* request (the turn) normally but
 * refuses the *non-streaming* request (the summarization) with HTTP 400. A 4xx
 * is not retried, so the rejection lands while the turn is still streaming --
 * the stream is held open for STREAM_DELAY_MS to make the race deterministic.
 *
 * Before the fix: exit code 1, an `UnhandledRejection` on stderr and no
 * `"type":"result"` event at all -- the turn was aborted mid-stream.
 * After the fix: exit code 0, a `result` event, and the summary failure is a
 * warning at most.
 *
 * Usage:
 *   bun experiments/issue-304-summary-rejection.mjs
 *
 * @see https://github.com/link-assistant/agent/issues/304
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

const STREAM_DELAY_MS = Number(process.env.STREAM_DELAY_MS ?? 4000);
const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
const requests = [];

const server = createServer((request, response) => {
  requests.push({ url: request.url, at: Date.now() });

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
    let parsed = {};
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = {};
    }

    // The summarization pass is the non-streaming call. Refuse it with a 4xx so
    // the AI SDK does not retry and the rejection arrives promptly.
    if (!parsed.stream) {
      console.log('[provider] refusing non-streaming (summary) request');
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ error: { message: 'mock summary failure' } })
      );
      return;
    }

    // The turn: answer normally, but slowly, so it is still in flight when the
    // summary rejects.
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunk = (delta, finishReason = null, extra = {}) =>
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
    }, STREAM_DELAY_MS);
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

const agent = spawn(
  'bun',
  [
    'run',
    'src/index.js',
    '--model',
    'formalai/formal-ai',
    '--no-always-accept-stdin',
    '--no-server',
    '--output-format',
    process.env.FMT ?? 'stream-json',
  ],
  {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      LINK_ASSISTANT_AGENT_COMPACT_JSON: '1',
      LINK_ASSISTANT_AGENT_CONFIG_CONTENT: '{}',
      LINK_ASSISTANT_AGENT_DEFAULT_COMPACTION_MODELS: '(same)',
      FORMAL_AI_API_KEY: 'local-test-token',
      FORMAL_AI_BASE_URL: `http://127.0.0.1:${port}/v1`,
    },
  }
);

let stdout = '';
let stderr = '';
agent.stdout.on('data', (d) => (stdout += d));
agent.stderr.on('data', (d) => (stderr += d));
agent.stdin.write('say hi\n');
agent.stdin.end();

const exitCode = await new Promise((resolve) => agent.on('close', resolve));

const events = stdout
  .split('\n')
  .filter((line) => line.trim().startsWith('{'))
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

console.log('exit code:', exitCode);
console.log('event order:', JSON.stringify(events.map((e) => e.type)));
console.log(
  'has result event:',
  events.some((e) => e.type === 'result')
);
console.log(
  'unhandled rejection on stderr:',
  stderr.includes('UnhandledRejection')
);
console.log('provider requests:', requests.length);
console.log(
  'summary log lines:',
  JSON.stringify(
    stdout
      .split('\n')
      .filter((line) => line.includes('summar') || line.includes('title'))
      .slice(0, 8)
  )
);
if (stderr.trim()) {
  console.log('stderr:', stderr.slice(-1200));
}

server.close();
process.exit(exitCode === 0 ? 0 : 1);
