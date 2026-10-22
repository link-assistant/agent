// Runs `agent models gpt4free --discover|--refresh [--free]` against a mock
// gpt4free server and prints `RESULT <json>` with the output and requests.
// Usage: bun experiments/issue-334/models-cli.ts
const requests: string[] = [];
const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    requests.push(`${req.method} ${url.pathname}`);
    if (url.pathname === '/v1/models') {
      return Response.json({
        data: [
          { id: 'Mock-Model', context_length: 1234 },
          {
            id: 'paid-model',
            pricing: { prompt: '0.001', completion: '0.002' },
          },
          { id: 'flux', image: true },
        ],
      });
    }
    return new Response('not found', { status: 404 });
  },
});

const entry = `${import.meta.dir}/../../js/src/index.js`;
async function run(...args: string[]) {
  const proc = Bun.spawn({
    cmd: ['bun', entry, 'models', ...args],
    cwd: `${import.meta.dir}/../../js`,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      LINK_ASSISTANT_AGENT_CONFIG_CONTENT: '{}',
      G4F_BASE_URL: `http://127.0.0.1:${server.port}/v1`,
    },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, lines: stdout.trim().split('\n').filter(Boolean), stderr };
}

const result = {
  plain: await run('gpt4free'),
  refresh: await run('gpt4free', '--refresh'),
  discoverCached: await run('gpt4free', '--discover'),
  free: await run('gpt4free', '--discover', '--free'),
  requests,
};
server.stop(true);
console.log(`RESULT ${JSON.stringify(result)}`);
