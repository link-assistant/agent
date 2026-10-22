import { describe, expect, test } from 'bun:test';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { AzureLogin } from '../src/auth/azure-login';
import { AuthPlugins } from '../src/auth/plugins';
import { ModelDiscovery } from '../src/provider/model-discovery';

/**
 * Microsoft Entra ID login for Azure through the Azure CLI and Azure
 * deployment discovery, ported from OpenCode (#334). `az` and Azure are
 * mocked throughout.
 */

const HOUR = 3600;

function fakeRun(tokens: string[], expiresIn = HOUR) {
  const calls: string[][] = [];
  const run: AzureLogin.Run = async (args) => {
    calls.push(args);
    const access = tokens.shift();
    if (!access) throw new Error('az: not logged in');
    return JSON.stringify({
      accessToken: access,
      expires_on: Math.floor(Date.now() / 1000) + expiresIn,
    });
  };
  return { calls, run };
}

describe('Azure CLI tokens', () => {
  test('parseToken reads expires_on seconds and expiresOn dates', () => {
    expect(
      AzureLogin.parseToken('{"accessToken":"a","expires_on":1700000000}')
    ).toEqual({ access: 'a', expires: 1700000000_000 });
    expect(
      AzureLogin.parseToken(
        '{"accessToken":"b","expiresOn":"2030-01-01T00:00:00Z"}'
      ).expires
    ).toBe(Date.parse('2030-01-01T00:00:00Z'));
    expect(() => AzureLogin.parseToken('{"expires_on":1}')).toThrow();
    expect(() =>
      AzureLogin.parseToken('{"accessToken":"c","expiresOn":"never"}')
    ).toThrow();
  });

  test('tokens are cached per scope and refreshed 5 minutes early', async () => {
    const { calls, run } = fakeRun(['t1', 't2', 't3']);
    let now = Date.now();
    const token = AzureLogin.tokenSource(run, () => now);
    expect(await token(AzureLogin.COGNITIVE_SCOPE)).toBe('t1');
    expect(await token(AzureLogin.COGNITIVE_SCOPE)).toBe('t1');
    expect(await token(AzureLogin.FOUNDRY_SCOPE)).toBe('t2');
    expect(calls[0]).toEqual([
      'account',
      'get-access-token',
      '--scope',
      AzureLogin.COGNITIVE_SCOPE,
      '--output',
      'json',
    ]);
    now += (HOUR - 4 * 60) * 1000;
    expect(await token(AzureLogin.COGNITIVE_SCOPE)).toBe('t3');
    expect(calls).toHaveLength(3);
  });

  test('concurrent requests share one az call', async () => {
    const { calls, run } = fakeRun(['t1']);
    const token = AzureLogin.tokenSource(run);
    const [a, b] = await Promise.all([
      token(AzureLogin.COGNITIVE_SCOPE),
      token(AzureLogin.COGNITIVE_SCOPE),
    ]);
    expect([a, b]).toEqual(['t1', 't1']);
    expect(calls).toHaveLength(1);
  });

  test('Foundry project endpoints use the ai.azure.com audience', () => {
    expect(
      AzureLogin.scopeFor('https://x.openai.azure.com/openai/v1/responses')
    ).toBe(AzureLogin.COGNITIVE_SCOPE);
    expect(
      AzureLogin.scopeFor('https://x.services.ai.azure.com/api/projects/p')
    ).toBe(AzureLogin.FOUNDRY_SCOPE);
    expect(
      AzureLogin.scopeFor('https://x.services.ai.azure.com/models/chat')
    ).toBe(AzureLogin.COGNITIVE_SCOPE);
  });

  test('entraFetch swaps the api-key header for a bearer token', async () => {
    let seen: Headers | undefined;
    const base = (async (_input: any, init?: RequestInit) => {
      seen = new Headers(init?.headers);
      return new Response('{}');
    }) as typeof fetch;
    const fetchImpl = AzureLogin.entraFetch(
      async (scope) => `tok:${scope}`,
      base
    );
    await fetchImpl('https://x.openai.azure.com/openai/v1/responses', {
      headers: { 'api-key': AzureLogin.PLACEHOLDER_KEY, 'x-extra': '1' },
    });
    expect(seen!.get('api-key')).toBeNull();
    expect(seen!.get('x-extra')).toBe('1');
    expect(seen!.get('authorization')).toBe(
      `Bearer tok:${AzureLogin.COGNITIVE_SCOPE}`
    );
  });
});

describe('Azure login plugin', () => {
  test('is registered with an Entra ID method and an API key method', () => {
    const plugin = AuthPlugins.getPlugin('azure');
    expect(plugin?.provider).toBe('azure');
    expect(plugin!.methods.map((m) => m.type)).toEqual(['oauth', 'api']);
    expect(plugin!.methods[1].authorize).toBeUndefined();
    const prompt = plugin!.methods[0].prompts![0];
    expect(prompt.key).toBe('resourceName');
    expect(prompt.validate!('my-models')).toBeUndefined();
    expect(prompt.validate!('evil.host/x')).toBeDefined();
  });

  test('saves the resource name once the Azure CLI session works', async () => {
    const { run } = fakeRun(['t1']);
    const method = AzureLogin.makePlugin(run).methods[0];
    const authorize: any = await method.authorize!({
      resourceName: 'my-models',
    });
    expect(authorize.method).toBe('auto');
    expect(await authorize.callback()).toEqual({
      type: 'success',
      provider: 'azure',
      refresh: AzureLogin.CLI_MARKER,
      access: '',
      expires: 0,
      enterpriseUrl: 'my-models',
    });
  });

  test('fails without an Azure CLI session or a valid resource name', async () => {
    const method = AzureLogin.makePlugin(fakeRun([]).run).methods[0];
    const authorize: any = await method.authorize!({
      resourceName: 'my-models',
    });
    expect(await authorize.callback()).toEqual({ type: 'failed' });
    expect(await method.authorize!({ resourceName: 'bad.name' })).toEqual({
      type: 'failed',
    });
  });

  test('options() only applies to stored Azure CLI logins', async () => {
    const token = async () => 't';
    expect(
      await AzureLogin.options({ type: 'api', key: 'k' }, token)
    ).toBeUndefined();
    const options = await AzureLogin.options(
      {
        type: 'oauth',
        refresh: AzureLogin.CLI_MARKER,
        access: '',
        expires: 0,
        enterpriseUrl: 'my-models',
      },
      token
    );
    expect(options?.resourceName).toBe('my-models');
    expect(options?.apiKey).toBe(AzureLogin.PLACEHOLDER_KEY);
    expect(typeof options?.fetch).toBe('function');
  });
});

describe('Azure deployment discovery', () => {
  test('lists deployments of the resource with the API key', () => {
    expect(
      ModelDiscovery.listingRequest({
        providerID: 'azure',
        npm: '@ai-sdk/azure',
        apiKey: 'k',
        resourceName: 'my-models',
      })
    ).toEqual({
      url: 'https://my-models.openai.azure.com/openai/deployments?api-version=2022-12-01',
      headers: { 'api-key': 'k' },
      shape: 'azure',
    });
  });

  test('uses an Azure host baseURL and keeps the catalogue for others', () => {
    expect(
      ModelDiscovery.listingRequest({
        providerID: 'azure-cognitive-services',
        npm: '@ai-sdk/azure',
        baseURL: 'https://r.cognitiveservices.azure.com/openai',
      })?.url
    ).toBe(
      'https://r.cognitiveservices.azure.com/openai/deployments?api-version=2022-12-01'
    );
    expect(
      ModelDiscovery.listingRequest({
        providerID: 'azure',
        npm: '@ai-sdk/azure',
        baseURL: 'https://proxy.example.com/openai',
        resourceName: 'my-models',
      })
    ).toBeUndefined();
    expect(
      ModelDiscovery.listingRequest({
        providerID: 'azure',
        npm: '@ai-sdk/azure',
      })
    ).toBeUndefined();
    expect(
      ModelDiscovery.listingRequest({
        providerID: 'azure',
        npm: '@ai-sdk/azure',
        resourceName: 'evil.com/x',
      })
    ).toBeUndefined();
  });

  test('keeps succeeded deployments and remembers their model', () => {
    expect(
      ModelDiscovery.normalize('azure', {
        data: [
          { id: 'prod-chat', model: 'gpt-4o', status: 'succeeded' },
          { id: 'new', model: 'gpt-4.1', status: 'creating' },
          { model: 'broken', status: 'succeeded' },
        ],
      })
    ).toEqual([{ id: 'prod-chat', model: 'gpt-4o' }]);
  });
});

describe('stored Azure CLI login reaches the provider registry', () => {
  test('requests and discovery use bearer tokens from az', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-334-azure-'));
    try {
      // A fake `az` that only answers `account get-access-token`.
      const bin = path.join(root, 'bin');
      await fs.mkdir(bin);
      await fs.writeFile(
        path.join(bin, 'az'),
        '#!/bin/sh\n[ "$1 $2" = "account get-access-token" ] || exit 2\n' +
          'echo \'{"accessToken":"entra-token","expires_on":4102444800}\'\n',
        { mode: 0o755 }
      );
      const proc = Bun.spawn(
        ['bun', '../experiments/issue-334/azure-entra.ts'],
        {
          cwd: path.join(import.meta.dir, '..'),
          env: {
            ...process.env,
            PATH: `${bin}${path.delimiter}${process.env.PATH}`,
            XDG_DATA_HOME: path.join(root, 'data'),
            XDG_CACHE_HOME: path.join(root, 'cache'),
          },
          stdout: 'pipe',
          stderr: 'pipe',
        }
      );
      const output = await new Response(proc.stdout).text();
      await proc.exited;
      const line = output.split('\n').find((l) => l.startsWith('RESULT '));
      expect(line).toBeDefined();
      const result = JSON.parse(line!.slice('RESULT '.length));
      expect(result.azure).toEqual({
        source: 'custom',
        resourceName: 'my-models',
        apiKey: AzureLogin.PLACEHOLDER_KEY,
        hasFetch: true,
      });
      expect(result.discovery).toEqual({
        status: 'ok',
        url: 'https://my-models.openai.azure.com/openai/deployments?api-version=2022-12-01',
        models: [{ id: 'chat', model: 'gpt-4o' }],
      });
      expect(result.requests).toHaveLength(2);
      for (const request of result.requests) {
        expect(request.auth).toBe('Bearer entra-token');
        expect(request.key).toBeNull();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});
