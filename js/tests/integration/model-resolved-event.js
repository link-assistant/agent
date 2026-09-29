import { test, expect, describe, setDefaultTimeout } from 'bun:test';
import { spawn } from 'child_process';
import { createServer } from 'http';
import { join } from 'path';

setDefaultTimeout(120000);

/**
 * End-to-end coverage for the `model_resolved` routing attestation.
 *
 * A supervisor that must verify routing needs the answer *before* the run can
 * talk to a provider, so these tests point the agent at a local fake provider
 * and check the ordering that makes the event actionable:
 *   - exactly one `model_resolved` per run,
 *   - emitted before the first `step_start`,
 *   - emitted before the first upstream HTTP request,
 *   - and, under `--output-format stream-json`, a single NDJSON line plus a
 *     `model` on the Claude `init` event.
 *
 * @see https://github.com/link-assistant/agent/issues/295
 */

/** Start a fake OpenAI-compatible provider that records when it is called. */
async function startFakeProvider() {
  const requests = [];

  const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };

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

      // Non-streaming calls (session summarization) want a plain JSON body.
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

      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
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

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Fake provider did not bind to a TCP port');
  }

  return {
    requests,
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function runAgent(input, args, env = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'bun',
      ['run', join(process.cwd(), 'src/index.js'), ...args],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          LINK_ASSISTANT_AGENT_COMPACT_JSON: '1',
          LINK_ASSISTANT_AGENT_CONFIG_CONTENT: '{}',
          LINK_ASSISTANT_AGENT_DEFAULT_COMPACTION_MODELS: '(same)',
          FORMAL_AI_API_KEY: 'local-test-token',
          ...env,
        },
      }
    );

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('close', (exitCode) => resolve({ stdout, stderr, exitCode }));
    proc.on('error', reject);

    proc.stdin.write(input);
    proc.stdin.end();
  });
}

function parseNdjson(text) {
  return text
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
}

const AGENT_ARGS = [
  '--model',
  'formalai/formal-ai',
  '--no-always-accept-stdin',
  '--no-server',
];

describe('model_resolved event (#295)', () => {
  test('is emitted once, before step_start and before the first request', async () => {
    const provider = await startFakeProvider();
    try {
      const { stdout, stderr } = await runAgent(
        'say hi\n',
        [...AGENT_ARGS, '--output-format', 'json'],
        { FORMAL_AI_BASE_URL: provider.baseURL }
      );

      const events = parseNdjson(stdout);
      const resolvedIndexes = events
        .map((event, index) => (event.type === 'model_resolved' ? index : -1))
        .filter((index) => index >= 0);

      expect(resolvedIndexes.length).toBe(1);

      const event = events[resolvedIndexes[0]];
      expect(event.requested).toBe('formalai/formal-ai');
      expect(event.providerID).toBe('formalai');
      expect(event.modelID).toBe('formal-ai');
      expect(event.source).toBe('cli');
      expect(event.matchesRequest).toBe(true);

      // Ordering inside the stream.
      const stepStartIndex = events.findIndex(
        (candidate) => candidate.type === 'step_start'
      );
      expect(stepStartIndex).toBeGreaterThan(-1);
      expect(resolvedIndexes[0]).toBeLessThan(stepStartIndex);

      // Ordering against the wire: the attestation must be readable before the
      // run can reach the provider.
      expect(provider.requests.length).toBeGreaterThan(0);
      const firstRequestAt = provider.requests[0].at;
      expect(new Date(event.timestamp).getTime()).toBeLessThanOrEqual(
        firstRequestAt
      );

      expect(stderr).not.toContain('model_resolved');
    } finally {
      await provider.close();
    }
  });

  test('stream-json keeps NDJSON valid and reports the model on init', async () => {
    const provider = await startFakeProvider();
    try {
      const { stdout } = await runAgent(
        'say hi\n',
        [...AGENT_ARGS, '--output-format', 'stream-json'],
        { FORMAL_AI_BASE_URL: provider.baseURL }
      );

      const resolvedLines = stdout
        .split('\n')
        .filter((line) => line.includes('"model_resolved"'));
      expect(resolvedLines.length).toBe(1);
      expect(JSON.parse(resolvedLines[0]).providerID).toBe('formalai');

      const events = parseNdjson(stdout);
      const initEvent = events.find((event) => event.type === 'init');
      expect(initEvent).toBeDefined();
      expect(initEvent.model).toBe('formalai/formal-ai');
    } finally {
      await provider.close();
    }
  });
});
