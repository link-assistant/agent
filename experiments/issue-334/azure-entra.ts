// Probe for #334: a stored Azure CLI (Microsoft Entra ID) login reaches the
// `azure` provider, its requests carry a bearer token minted by `az`, and its
// deployments are discovered with that token. Run with an isolated
// XDG_DATA_HOME and a fake `az` first on PATH (see tests/azure-login.ts);
// Azure endpoints are mocked, so nothing leaves the machine.
//
// Usage: XDG_DATA_HOME=$(mktemp -d) PATH=<fake-az-dir>:$PATH \
//   bun experiments/issue-334/azure-entra.ts
// Prints one `RESULT <json>` line.
import path from 'path';
import fs from 'fs/promises';

const dataHome = process.env.XDG_DATA_HOME;
if (!dataHome || !dataHome.includes('tmp')) {
  throw new Error('set XDG_DATA_HOME to a temporary directory');
}
delete process.env.AZURE_API_KEY;
delete process.env.AZURE_RESOURCE_NAME;
const authFile = path.join(dataHome, 'link-assistant-agent', 'auth.json');
await fs.mkdir(path.dirname(authFile), { recursive: true });
await fs.writeFile(
  authFile,
  JSON.stringify({
    azure: {
      type: 'oauth',
      refresh: 'azure-cli',
      access: '',
      expires: 0,
      enterpriseUrl: 'my-models',
    },
  })
);

const requests: Array<{
  url: string;
  auth: string | null;
  key: string | null;
}> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith('https://my-models.openai.azure.com/')) {
    const headers = new Headers(init?.headers);
    requests.push({
      url,
      auth: headers.get('authorization'),
      key: headers.get('api-key'),
    });
    if (url.includes('/deployments?')) {
      return Response.json({
        data: [
          { id: 'chat', model: 'gpt-4o', status: 'succeeded' },
          { id: 'pending', model: 'gpt-4.1', status: 'running' },
        ],
      });
    }
    return Response.json({ ok: true });
  }
  return realFetch(input, init);
}) as typeof fetch;

const { Instance } = await import('../../js/src/project/instance');
const { Provider } = await import('../../js/src/provider/provider');
const { ModelDiscovery } =
  await import('../../js/src/provider/model-discovery');

const result: Record<string, any> = {};
await Instance.provide({
  directory: process.cwd(),
  fn: async () => {
    const s = await Provider.state();
    const azure = s.providers['azure'];
    result.azure = azure
      ? {
          source: azure.source,
          resourceName: azure.options.resourceName,
          apiKey: azure.options.apiKey,
          hasFetch: typeof azure.options.fetch === 'function',
        }
      : null;
    if (azure) {
      await azure.options.fetch(
        'https://my-models.openai.azure.com/openai/v1/responses',
        { method: 'POST', headers: { 'api-key': azure.options.apiKey } }
      );
      ModelDiscovery.clearMemoryCache();
      const found = await Provider.discoverModels('azure', { force: true });
      result.discovery = {
        status: found.status,
        url: found.url,
        models: found.models,
      };
    }
  },
});
result.requests = requests;
console.log(`RESULT ${JSON.stringify(result)}`);
process.exit(0);
