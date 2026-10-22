// Probe for #334: stored xAI / DigitalOcean / GitLab subscription logins reach the
// provider registry through their auth plugin loaders. Run with an isolated
// XDG_DATA_HOME (the auth.json written here is fake). The xAI token endpoint
// and GitLab token endpoints are mocked, so no network login happens.
//
// Usage: XDG_DATA_HOME=$(mktemp -d) bun experiments/issue-334/oauth-providers.ts
// Prints one `RESULT <json>` line.
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

const dataHome = process.env.XDG_DATA_HOME;
// os.tmpdir() is /var/folders/... on macOS and ...\Temp on Windows.
if (
  !dataHome ||
  !path.resolve(dataHome).startsWith(path.resolve(os.tmpdir()) + path.sep)
) {
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
    gitlab: {
      type: 'oauth',
      access: 'old-gitlab-access',
      refresh: 'gitlab-refresh',
      expires: Date.now() - 1000,
      enterpriseUrl: 'https://gitlab.example.com/root',
    },
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
  if (url === 'https://gitlab.example.com/root/oauth/token') {
    refreshRequests.push(String(init?.body));
    return Response.json({
      access_token: 'new-gitlab-access',
      refresh_token: 'gitlab-refresh-2',
      expires_in: 7200,
    });
  }
  return realFetch(input, init);
}) as typeof fetch;

/**
 * Credentials are reported only as whether they equal the expected mock
 * value, so the RESULT line never prints a secret.
 */
function is(value: unknown, expected: string): boolean {
  return value === expected;
}

const { Instance } = await import('../../js/src/project/instance');
const { Provider } = await import('../../js/src/provider/provider');

const result: Record<string, any> = {};
await Instance.provide({
  directory: process.cwd(),
  fn: async () => {
    const s = await Provider.state();
    const keys: Record<string, string> = {
      xai: 'new-xai-access',
      digitalocean: 'do-access',
      poe: 'poe-key',
    };
    for (const [id, key] of Object.entries(keys)) {
      const provider = s.providers[id];
      result[id] = provider
        ? { source: provider.source, apiKey: is(provider.options.apiKey, key) }
        : null;
    }
    const gitlab = s.providers['gitlab'];
    result.gitlab = gitlab
      ? {
          apiKey: is(gitlab.options.apiKey, 'new-gitlab-access'),
          instanceUrl: gitlab.options.instanceUrl,
        }
      : null;
  },
});
result.refreshRequests = refreshRequests;
const stored = JSON.parse(await fs.readFile(authFile, 'utf8'));
result.storedXai = {
  access: is(stored.xai.access, 'new-xai-access'),
  refresh: is(stored.xai.refresh, 'xai-refresh-2'),
  fresh: stored.xai.expires > Date.now(),
};
result.storedGitlab = {
  access: is(stored.gitlab.access, 'new-gitlab-access'),
  refresh: is(stored.gitlab.refresh, 'gitlab-refresh-2'),
  enterpriseUrl: stored.gitlab.enterpriseUrl,
};
console.log(`RESULT ${JSON.stringify(result)}`);
process.exit(0);
