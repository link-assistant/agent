#!/usr/bin/env bun
/**
 * Manual probe for the `model_resolved` routing attestation (#295).
 *
 * Runs the real CLI against a local fake OpenAI-compatible provider and prints
 * the event ordering, so the guarantees can be inspected by hand:
 *   - `model_resolved` appears exactly once,
 *   - before `step_start` (opencode) / `init` (claude),
 *   - before the first request hits the fake provider.
 *
 * Usage:
 *   bun experiments/model-resolved-fake-provider.mjs            # opencode standard
 *   FMT=stream-json bun experiments/model-resolved-fake-provider.mjs
 *   MODEL=formal-ai bun experiments/model-resolved-fake-provider.mjs
 *   MODEL= bun experiments/model-resolved-fake-provider.mjs      # default path
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

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
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = {};
    }

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
    response.write(chunk({}, 'stop', { usage }));
    response.write('data: [DONE]\n\n');
    response.end();
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

const model = 'MODEL' in process.env ? process.env.MODEL : 'formalai/formal-ai';
const format = process.env.FMT ?? 'json';

const agent = spawn(
  'bun',
  [
    'run',
    'src/index.js',
    ...(model ? ['--model', model] : []),
    '--no-always-accept-stdin',
    '--no-server',
    '--output-format',
    format,
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
  .filter(Boolean)
  .filter((event) => event.type !== 'log');

console.log('exit code:', exitCode);
console.log('event order:', JSON.stringify(events.map((e) => e.type)));
console.log(
  'model_resolved:',
  JSON.stringify(events.find((e) => e.type === 'model_resolved'))
);
console.log('init:', JSON.stringify(events.find((e) => e.type === 'init')));
console.log('first upstream request at:', requests[0]?.at, requests[0]?.url);
if (exitCode !== 0) {
  console.log('stderr tail:', stderr.slice(-600));
}

server.close();
