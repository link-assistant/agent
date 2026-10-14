import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

/**
 * A failed tool call that the model recovers from is not a session error.
 *
 * The model asks `read` for a file that does not exist, receives the
 * `File not found` tool result and finishes the turn normally. The event
 * stream must report that failure only on the tool's own event
 * (`tool_use` with `part.state.status: "error"` in OpenCode output,
 * `tool_result` with `status: "error"` in Claude output) and must not contain
 * a top-level `{"type":"error"}` event, which consumers such as Hive Mind
 * rightly treat as fatal.
 *
 * @see https://github.com/link-assistant/agent/issues/332
 */

setDefaultTimeout(60000);

/**
 * An OpenAI-compatible provider whose first turn calls `read` on a missing
 * file and whose follow-up turn (the one carrying the tool result) answers
 * with plain text.
 */
async function startToolFailingProvider(missingFile: string) {
  const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
  const toolResults: string[] = [];

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
      let parsed: { stream?: boolean; messages?: any[] } = {};
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = {};
      }

      // Non-streaming requests are secondary calls (title, summary).
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
                message: { role: 'assistant', content: 'title' },
                finish_reason: 'stop',
              },
            ],
            usage,
          })
        );
        return;
      }

      const toolMessage = (parsed.messages ?? []).find(
        (message) => message.role === 'tool'
      );

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

      if (toolMessage) {
        toolResults.push(
          typeof toolMessage.content === 'string'
            ? toolMessage.content
            : JSON.stringify(toolMessage.content)
        );
        response.write(
          chunk({ role: 'assistant', content: 'The file does not exist.' })
        );
        response.write(chunk({}, 'stop', { usage }));
      } else {
        response.write(
          chunk({
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'call_missing_file',
                type: 'function',
                function: {
                  name: 'read',
                  arguments: JSON.stringify({ filePath: missingFile }),
                },
              },
            ],
          })
        );
        response.write(chunk({}, 'tool_calls', { usage }));
      }
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
    toolResults,
    baseURL: `http://127.0.0.1:${port}/v1`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function parseEvents(text: string) {
  return text
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
}

async function runAgentWithFailingTool(standard: 'opencode' | 'claude') {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'agent-recoverable-tool-error-')
  );
  const missingFile = path.join(directory, 'e.g');
  const provider = await startToolFailingProvider(missingFile);
  try {
    const proc = Bun.spawn({
      cmd: [
        'bun',
        'run',
        path.join(process.cwd(), 'src/index.js'),
        '--model',
        'formalai/formal-ai',
        '--no-always-accept-stdin',
        '--no-server',
        '--json-standard',
        standard,
      ],
      // The agent's project directory is its working directory.
      cwd: directory,
      stdin: new TextEncoder().encode('read the file\n'),
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

    return {
      exitCode,
      stdout,
      stderr,
      stdoutEvents: parseEvents(stdout),
      stderrEvents: parseEvents(stderr),
      // `error` events are written to stderr, so read both streams.
      events: [...parseEvents(stdout), ...parseEvents(stderr)],
      toolResults: provider.toolResults,
      context: `exit=${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    };
  } finally {
    await provider.close();
    await rm(directory, { recursive: true, force: true });
  }
}

describe('a recovered tool failure is not a fatal error event (#332)', () => {
  test('OpenCode output reports it only on the tool_use event', async () => {
    const run = await runAgentWithFailingTool('opencode');

    // The tool really failed and the model really saw the failure.
    expect(run.toolResults.length, run.context).toBe(1);
    expect(run.toolResults[0], run.context).toContain('File not found');

    const failedTool = run.events.find(
      (event) =>
        event.type === 'tool_use' &&
        event.part?.tool === 'read' &&
        event.part?.state?.status === 'error'
    );
    expect(failedTool, run.context).toBeDefined();
    expect(failedTool!.part.state.error, run.context).toContain(
      'File not found'
    );

    // The model continued after the failure…
    expect(
      run.events.some(
        (event) =>
          event.type === 'text' &&
          event.part?.text === 'The file does not exist.'
      ),
      run.context
    ).toBe(true);

    // …so nothing in the stream may claim that the session failed.
    expect(
      run.events.filter((event) => event.type === 'error'),
      run.context
    ).toEqual([]);
    expect(run.exitCode, run.context).toBe(0);
  });

  test('Claude output reports it only as an error tool_result', async () => {
    const run = await runAgentWithFailingTool('claude');

    expect(run.toolResults.length, run.context).toBe(1);

    const toolUse = run.events.find(
      (event) => event.type === 'tool_use' && event.name === 'read'
    );
    expect(toolUse, run.context).toBeDefined();

    // The failed result is ordinary output on stdout, not on the error stream.
    const toolResults = run.stdoutEvents.filter(
      (event) =>
        event.type === 'tool_result' &&
        event.tool_use_id === toolUse!.tool_use_id
    );
    expect(toolResults, run.context).toHaveLength(1);
    expect(
      run.stderrEvents.filter((event) => event.type === 'tool_result'),
      run.context
    ).toEqual([]);
    expect(toolResults[0].status, run.context).toBe('error');
    expect(toolResults[0].output, run.context).toContain('File not found');

    // The run's terminal results are all successful.
    const results = run.events.filter((event) => event.type === 'result');
    expect(results.length, run.context).toBeGreaterThan(0);
    expect(
      results.filter((event) => event.status !== 'success'),
      run.context
    ).toEqual([]);
    expect(
      run.events.filter((event) => event.type === 'error'),
      run.context
    ).toEqual([]);
    expect(run.exitCode, run.context).toBe(0);
  });
});
