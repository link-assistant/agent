// Probe for #334: stored xAI / DigitalOcean subscription logins reach the
// provider registry through their auth plugin loaders. Run with an isolated
// XDG_DATA_HOME (the auth.json written here is fake). The xAI token endpoint
// is mocked, so no network login happens.
//
// Usage: XDG_DATA_HOME=$(mktemp -d) bun experiments/issue-334/oauth-providers.ts
// Prints one `RESULT <json>` line.
import path from 'path';
import fs from 'fs/promises';

const dataHome = process.env.XDG_DATA_HOME;
if (!dataHome || !dataHome.includes('tmp')) {
  throw new Error('set XDG_DATA_HOME to a temporary directory');
}
const authFile = path.join(dataHome, 'link-assistant-agent', 'auth.json');
await fs.mkdir(path.dirname(authFile), { recursive: true });
await fs.writeFile(
  authFile,
  JSON.stringify({
    // Expired: the loader must refresh it before use.
    xai: {
      type: 'oauth',
      access: 'old-xai-access',
      refresh: 'xai-refresh',
      expires: Date.now() - 1000,
    },
    digitalocean: {
      type: 'oauth',
      access: 'do-access',
      refresh: '',
      expires: Date.now() + 3600_000,
    },
    poe: { type: 'api', key: 'poe-key' },
  })
);

const refreshRequests: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url === 'https://auth.x.ai/oauth2/token') {
    refreshRequests.push(String(init?.body));
    return Response.json({
      access_token: 'new-xai-access',
      refresh_token: 'xai-refresh-2',
      expires_in: 3600,
    });
  }
  return realFetch(input, init);
}) as typeof fetch;

const { Instance } = await import('../../js/src/project/instance');
const { Provider } = await import('../../js/src/provider/provider');

const result: Record<string, any> = {};
await Instance.provide({
  directory: process.cwd(),
  fn: async () => {
    const s = await Provider.state();
    for (const id of ['xai', 'digitalocean', 'poe']) {
      const provider = s.providers[id];
      result[id] = provider
        ? { source: provider.source, apiKey: provider.options.apiKey }
        : null;
    }
  },
});
result.refreshRequests = refreshRequests;
const stored = JSON.parse(await fs.readFile(authFile, 'utf8'));
result.storedXai = {
  access: stored.xai.access,
  refresh: stored.xai.refresh,
  fresh: stored.xai.expires > Date.now(),
};
console.log(`RESULT ${JSON.stringify(result)}`);
process.exit(0);
