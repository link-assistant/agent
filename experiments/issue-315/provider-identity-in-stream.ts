/**
 * Reproduce issue #313 / #315: with an explicit `--model` and auxiliary calls
 * off, list every stream record that names a provider other than the one the
 * run was pointed at.
 *
 * Usage (from js/):
 *   bun ../experiments/issue-315/provider-identity-in-stream.ts
 *
 * Starts a fake OpenAI-compatible Formal AI server, runs one turn with
 *   agent --model formalai/formal-ai --no-summarize-session --no-generate-title --verbose
 * and prints every record carrying a `providerID`/`modelID` field (at any
 * depth) together with its `service` and `message`. Set RAW_OUT=<file> to
 * keep the raw stream.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

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
    const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
    const chunk = (delta: object, finish: string | null = null, extra = {}) =>
      `data: ${JSON.stringify({
        id: 'x',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'formal-ai',
        choices: [{ index: 0, delta, finish_reason: finish }],
        ...extra,
      })}\n\n`;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(chunk({ role: 'assistant', content: 'hi' }));
    response.write(chunk({}, 'stop', { usage }));
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
    FORMAL_AI_BASE_URL: `http://127.0.0.1:${port}/v1`,
  },
});
const [stdout, stderr, exitCode] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
  proc.exited,
]);
server.close();
if (process.env.RAW_OUT)
  await Bun.write(process.env.RAW_OUT, `${stdout}\n${stderr}`);

function* identities(value: unknown, path = ''): Generator<[string, string]> {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (
      (key === 'providerID' || key === 'modelID') &&
      typeof child === 'string'
    )
      yield [`${path}${key}`, child];
    else yield* identities(child, `${path}${key}.`);
  }
}

let foreign = 0;
for (const line of `${stdout}\n${stderr}`.split('\n')) {
  if (!line.trim().startsWith('{')) continue;
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(line);
  } catch {
    continue;
  }
  const found = [...identities(record)];
  if (found.length === 0) continue;
  const providers = found
    .filter(([k]) => k.endsWith('providerID'))
    .map(([, v]) => v);
  const isForeign = providers.some((p) => p !== 'formalai');
  if (isForeign) foreign++;
  console.log(
    `${isForeign ? 'FOREIGN' : 'ok     '} ${record.type}/${record.service ?? '-'} ${JSON.stringify(record.message ?? '')} ${JSON.stringify(Object.fromEntries(found))}`
  );
}
console.log(`\nexit=${exitCode} foreignRecords=${foreign}`);
