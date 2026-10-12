import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/** Exercise real SDK/session paths while recording the exact HTTP model IDs. */
export async function runMockTurn(
  provider: 'kilo' | 'opencode',
  refusal = false
) {
  const requests: Array<{ model: string; stream?: boolean }> = [];
  const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      const parsed = JSON.parse(body);
      requests.push({ model: parsed.model, stream: parsed.stream });
      if (refusal) {
        response.writeHead(403, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            type: 'error',
            error: { type: 'FreeTierError', message: 'Forbidden' },
          })
        );
        return;
      }
      if (parsed.model !== 'nvidia/nemotron-3-super-120b-a12b:free') {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'Model not found' } }));
        return;
      }
      if (!parsed.stream) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            id: 'mock',
            object: 'chat.completion',
            created: 0,
            model: parsed.model,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'A title' },
                finish_reason: 'stop',
              },
            ],
            usage,
          })
        );
        return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const [delta, finish_reason] of [
        [{ role: 'assistant', content: 'hello' }, null],
        [{}, 'stop'],
      ]) {
        response.write(
          `data: ${JSON.stringify({
            id: 'mock',
            object: 'chat.completion.chunk',
            created: 0,
            model: parsed.model,
            choices: [{ index: 0, delta, finish_reason }],
            usage,
          })}\n\n`
        );
      }
      response.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const proc = Bun.spawn({
    cmd: [
      'bun',
      'run',
      'src/index.js',
      '--no-always-accept-stdin',
      '--no-server',
      '--output-format',
      'stream-json',
      ...(provider === 'opencode'
        ? ['--model', 'opencode/big-pickle', '--no-summarize-session']
        : []),
    ],
    stdin: new TextEncoder().encode('Say hello\n'),
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      KILO_API_KEY: 'local-test-token',
      LINK_ASSISTANT_AGENT_DEFAULT_MODEL: '',
      LINK_ASSISTANT_AGENT_DEFAULT_COMPACTION_MODEL: '',
      LINK_ASSISTANT_AGENT_DEFAULT_COMPACTION_MODELS: '',
      LINK_ASSISTANT_AGENT_COMPACT_JSON: '1',
      LINK_ASSISTANT_AGENT_CONFIG_CONTENT: JSON.stringify({
        provider: {
          [provider]: {
            options: {
              baseURL: `http://127.0.0.1:${port}/v1`,
              apiKey: 'local-test-token',
            },
          },
        },
      }),
    },
  });
  const deadline = setTimeout(() => proc.kill(), 30000);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { requests, stdout, stderr, exitCode };
  } finally {
    clearTimeout(deadline);
    proc.kill();
    await proc.exited;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}
