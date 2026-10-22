import { describe, expect, test } from 'bun:test';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { ProviderLogins } from '../src/auth/provider-logins';
import { AuthPlugins } from '../src/auth/plugins';

/**
 * Subscription logins ported from OpenCode for xAI, Poe and DigitalOcean
 * (#334). Every network call is mocked.
 */

type Call = { url: string; body: URLSearchParams };

function mockFetch(responses: Array<() => Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: any, init?: any) => {
    calls.push({
      url: String(input),
      body: new URLSearchParams(String(init?.body ?? '')),
    });
    const next = responses.shift();
    if (!next) throw new Error('unexpected request');
    return next();
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('auth plugin registry', () => {
  test('xai, poe and digitalocean offer a login and an API key method', () => {
    for (const id of ['xai', 'poe', 'digitalocean', 'gitlab']) {
      const plugin = AuthPlugins.getPlugin(id);
      expect(plugin?.provider).toBe(id);
      expect(plugin!.methods.map((m) => m.type)).toEqual(['oauth', 'api']);
      // The API key method falls back to the CLI's masked key prompt.
      expect(plugin!.methods[1].authorize).toBeUndefined();
    }
  });
});

describe('xAI device login', () => {
  const device = {
    device_code: 'dev-code',
    user_code: 'ABCD-EFGH',
    verification_uri: 'https://accounts.x.ai/device',
    expires_in: 600,
    interval: 1,
  };

  test('tokenExpiration prefers expires_in, then the JWT exp claim', () => {
    expect(
      ProviderLogins.tokenExpiration({ access_token: 'x', expires_in: 10 }, 0)
    ).toBe(10_000);
    const payload = Buffer.from(JSON.stringify({ exp: 1234 })).toString(
      'base64url'
    );
    expect(
      ProviderLogins.tokenExpiration({ access_token: `h.${payload}.s` }, 0)
    ).toBe(1_234_000);
    expect(ProviderLogins.tokenExpiration({ access_token: 'opaque' }, 0)).toBe(
      3_600_000
    );
  });

  test('polls through authorization_pending and slow_down', async () => {
    const waits: number[] = [];
    const { calls, fetchImpl } = mockFetch([
      () => Response.json({ error: 'authorization_pending' }, { status: 400 }),
      () => Response.json({ error: 'slow_down' }, { status: 400 }),
      () =>
        Response.json({
          access_token: 'access',
          refresh_token: 'refresh',
          expires_in: 3600,
        }),
    ]);
    const token = await ProviderLogins.pollXAIDevice(device, {
      fetchImpl,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(token.access_token).toBe('access');
    // interval + 3s margin, then +5s after slow_down.
    expect(waits).toEqual([4000, 9000]);
    expect(calls).toHaveLength(3);
    expect(calls[0].url).toBe(`${ProviderLogins.XAI_ISSUER}/token`);
    expect(Object.fromEntries(calls[0].body)).toEqual({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: ProviderLogins.XAI_CLIENT_ID,
      device_code: 'dev-code',
    });
  });

  test('denied and expired device codes fail with a clear message', async () => {
    for (const [error, message] of [
      ['access_denied', /denied/],
      ['expired_token', /expired/],
      ['invalid_client', /invalid_client/],
    ] as const) {
      const { fetchImpl } = mockFetch([
        () => Response.json({ error }, { status: 400 }),
      ]);
      await expect(
        ProviderLogins.pollXAIDevice(device, {
          fetchImpl,
          sleep: async () => {},
        })
      ).rejects.toThrow(message);
    }
  });

  test('gives up once the device code lifetime has passed', async () => {
    let clock = 0;
    const { fetchImpl } = mockFetch(
      Array.from(
        { length: 10 },
        () => () =>
          Response.json({ error: 'authorization_pending' }, { status: 400 })
      )
    );
    await expect(
      ProviderLogins.pollXAIDevice(
        { ...device, expires_in: 10 },
        {
          fetchImpl,
          now: () => clock,
          sleep: async (ms) => {
            clock += ms;
          },
        }
      )
    ).rejects.toThrow(/timed out/);
  });

  test('refreshXAI keeps the old refresh token when none is returned', async () => {
    const { calls, fetchImpl } = mockFetch([
      () => Response.json({ access_token: 'new', expires_in: 60 }),
    ]);
    const auth = await ProviderLogins.refreshXAI('old-refresh', fetchImpl);
    expect(auth).toMatchObject({
      type: 'oauth',
      access: 'new',
      refresh: 'old-refresh',
    });
    expect(calls[0].body.get('grant_type')).toBe('refresh_token');
    expect(calls[0].body.get('refresh_token')).toBe('old-refresh');
  });

  test('the loader passes through stored API keys and fresh tokens', async () => {
    const loader = ProviderLogins.XAIPlugin.loader!;
    expect(await loader(async () => ({ type: 'api', key: 'k' }), {})).toEqual({
      apiKey: 'k',
    });
    expect(
      await loader(
        async () => ({
          type: 'oauth',
          access: 'a',
          refresh: 'r',
          expires: Date.now() + 3600_000,
        }),
        {}
      )
    ).toEqual({ apiKey: 'a' });
    expect(await loader(async () => undefined, {})).toEqual({});
  });
});

describe('Poe login', () => {
  const state = 'state-123';

  test('validates state, issuer, errors and code', () => {
    const check = (query: string) =>
      ProviderLogins.poeCallbackError(new URLSearchParams(query), state);
    expect(check(`state=${state}&code=abc`)).toBeUndefined();
    expect(
      check(`state=${state}&code=abc&iss=https://poe.com`)
    ).toBeUndefined();
    expect(check('state=other&code=abc')).toBe('Invalid OAuth state');
    expect(check(`state=${state}&code=abc&iss=https://evil.example`)).toBe(
      'Invalid OAuth issuer'
    );
    expect(check(`state=${state}&error=access_denied`)).toBe('access_denied');
    expect(check(`state=${state}`)).toBe('Missing authorization code');
  });

  test('exchanges the code for an API key', async () => {
    const { calls, fetchImpl } = mockFetch([
      () => Response.json({ api_key: 'poe-key', api_key_expires_in: 60 }),
    ]);
    const result = await ProviderLogins.exchangePoeCode(
      { code: 'c', redirect: 'http://127.0.0.1:1/callback', verifier: 'v' },
      fetchImpl,
      0
    );
    expect(result).toEqual({ key: 'poe-key', expires: 60_000 });
    expect(calls[0].url).toBe('https://api.poe.com/token');
    expect(Object.fromEntries(calls[0].body)).toEqual({
      grant_type: 'authorization_code',
      client_id: ProviderLogins.POE_CLIENT_ID,
      code: 'c',
      redirect_uri: 'http://127.0.0.1:1/callback',
      code_verifier: 'v',
    });
  });

  test('exchange errors never echo the code or verifier', async () => {
    const { fetchImpl } = mockFetch([
      () =>
        Response.json(
          { error: 'invalid_grant', error_description: 'bad code secret-code' },
          { status: 400 }
        ),
    ]);
    const error = await ProviderLogins.exchangePoeCode(
      { code: 'secret-code', redirect: 'r', verifier: 'v' },
      fetchImpl
    ).catch((e) => e as Error);
    expect(String(error)).toContain('(400)');
    expect(String(error)).not.toContain('secret-code');
  });

  test('browser flow: loopback callback leads to a stored API key', async () => {
    const realFetch = globalThis.fetch;
    const exchanged: URLSearchParams[] = [];
    globalThis.fetch = (async (input: any, init?: any) => {
      if (String(input) === 'https://api.poe.com/token') {
        exchanged.push(new URLSearchParams(String(init?.body)));
        return Response.json({ api_key: 'poe-key' });
      }
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      const authorize = (await ProviderLogins.PoePlugin.methods[0].authorize!(
        {}
      )) as any;
      const url = new URL(authorize.url);
      expect(url.origin + url.pathname).toBe('https://poe.com/oauth/authorize');
      expect(url.searchParams.get('scope')).toBe('apikey:create');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      const redirect = url.searchParams.get('redirect_uri')!;
      const pending = authorize.callback();
      const page = await realFetch(
        `${redirect}?code=the-code&state=${url.searchParams.get('state')}`
      );
      expect(page.status).toBe(200);
      expect(await pending).toEqual({
        type: 'success',
        provider: 'poe',
        key: 'poe-key',
      });
      expect(exchanged[0].get('code')).toBe('the-code');
      expect(exchanged[0].get('redirect_uri')).toBe(redirect);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('DigitalOcean login', () => {
  test('parses the posted URL fragment', () => {
    expect(
      ProviderLogins.parseDigitalOceanToken(
        JSON.stringify({ access_token: 't', expires_in: '120', state: 's' }),
        's'
      )
    ).toEqual({ access: 't', expiresIn: 120 });
    // Missing expiry defaults to 30 days.
    expect(
      ProviderLogins.parseDigitalOceanToken(
        JSON.stringify({ access_token: 't', state: 's' }),
        's'
      )
    ).toEqual({ access: 't', expiresIn: 2_592_000 });
    expect(
      ProviderLogins.parseDigitalOceanToken(
        JSON.stringify({ access_token: 't', state: 'x' }),
        's'
      )
    ).toEqual({ error: 'Invalid OAuth state' });
    expect(
      ProviderLogins.parseDigitalOceanToken(
        JSON.stringify({ error: 'access_denied' }),
        's'
      )
    ).toEqual({ error: 'access_denied' });
    expect(ProviderLogins.parseDigitalOceanToken('not json', 's')).toEqual({
      error: 'Missing access token',
    });
  });

  test('bootstrap page posts the fragment to the token endpoint', () => {
    const page = ProviderLogins.digitalOceanBootstrapPage();
    expect(page).toContain('location.hash');
    expect(page).toContain("fetch('/auth/token'");
  });

  test('browser flow: fragment posted to the loopback server', async () => {
    const authorize = (await ProviderLogins.DigitalOceanPlugin.methods[0]
      .authorize!({})) as any;
    // Port 1456 is fixed by the registered redirect URI; skip if taken.
    if (authorize.type === 'failed') return;
    const url = new URL(authorize.url);
    expect(url.searchParams.get('response_type')).toBe('token');
    expect(url.searchParams.get('client_id')).toBe(
      ProviderLogins.DIGITALOCEAN_CLIENT_ID
    );
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:1456/auth/callback'
    );
    const pending = authorize.callback();
    const page = await fetch('http://localhost:1456/auth/callback');
    expect(await page.text()).toContain('location.hash');
    const posted = await fetch('http://localhost:1456/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: 'do-token',
        expires_in: '60',
        state: url.searchParams.get('state'),
      }),
    });
    expect(await posted.json()).toEqual({ ok: true });
    const result = await pending;
    expect(result).toMatchObject({
      type: 'success',
      provider: 'digitalocean',
      access: 'do-token',
      refresh: '',
    });
    expect(result.expires).toBeGreaterThan(Date.now());
  });

  test('the loader ignores expired tokens', async () => {
    const loader = ProviderLogins.DigitalOceanPlugin.loader!;
    const token = (expires: number) => async () =>
      ({ type: 'oauth', access: 'a', refresh: '', expires }) as const;
    expect(await loader(token(Date.now() + 60_000), {})).toEqual({
      apiKey: 'a',
    });
    expect(await loader(token(Date.now() - 1), {})).toEqual({});
  });
});

describe('GitLab login', () => {
  test('normalizes the instance URL and keeps a relative root', () => {
    expect(ProviderLogins.gitlabInstanceUrl(undefined, {})).toBe(
      'https://gitlab.com'
    );
    expect(
      ProviderLogins.gitlabInstanceUrl(' https://git.example.com/gitlab/ ', {})
    ).toBe('https://git.example.com/gitlab');
    expect(
      ProviderLogins.gitlabInstanceUrl('', {
        GITLAB_INSTANCE_URL: 'https://self.example.com',
      })
    ).toBe('https://self.example.com');
    expect(() => ProviderLogins.gitlabInstanceUrl('ftp://x', {})).toThrow();
  });

  test('GITLAB_OAUTH_CLIENT_ID overrides the bundled application', () => {
    expect(ProviderLogins.gitlabClientID({})).toBe(
      ProviderLogins.GITLAB_CLIENT_ID
    );
    expect(
      ProviderLogins.gitlabClientID({ GITLAB_OAUTH_CLIENT_ID: ' x ' })
    ).toBe('x');
  });

  test('token exchange stores the instance and defaults to a 2h expiry', async () => {
    const { calls, fetchImpl } = mockFetch([
      () => Response.json({ access_token: 'a', refresh_token: 'r' }),
    ]);
    const auth = await ProviderLogins.exchangeGitLabToken(
      'https://gitlab.com',
      { grant_type: 'authorization_code', code: 'c', code_verifier: 'v' },
      fetchImpl,
      0
    );
    expect(auth).toEqual({
      type: 'oauth',
      access: 'a',
      refresh: 'r',
      expires: 7_200_000,
      enterpriseUrl: 'https://gitlab.com',
    });
    expect(calls[0].url).toBe('https://gitlab.com/oauth/token');
    expect(calls[0].body.get('redirect_uri')).toBe(
      ProviderLogins.GITLAB_REDIRECT_URI
    );
    expect(calls[0].body.get('code_verifier')).toBe('v');
  });

  test('rejected grants explain the likely causes', async () => {
    const { fetchImpl } = mockFetch([
      () => Response.json({ error: 'invalid_grant' }, { status: 400 }),
    ]);
    await expect(
      ProviderLogins.exchangeGitLabToken(
        'https://gitlab.com',
        { grant_type: 'refresh_token', refresh_token: 'r' },
        fetchImpl
      )
    ).rejects.toThrow(/fresh login/);
  });

  test('concurrent refreshes of one token share a single exchange', async () => {
    const { calls, fetchImpl } = mockFetch([
      () => Response.json({ access_token: 'a2', refresh_token: 'r2' }),
    ]);
    const auth = {
      type: 'oauth' as const,
      access: 'a',
      refresh: 'shared-refresh',
      expires: 0,
      enterpriseUrl: 'https://gitlab.com',
    };
    const [first, second] = await Promise.all([
      ProviderLogins.refreshGitLab(auth, fetchImpl),
      ProviderLogins.refreshGitLab(auth, fetchImpl),
    ]);
    expect(first.access).toBe('a2');
    expect(second.refresh).toBe('r2');
    expect(calls).toHaveLength(1);
  });

  test('self-managed hosts need their own OAuth application', async () => {
    const previous = process.env.GITLAB_OAUTH_CLIENT_ID;
    delete process.env.GITLAB_OAUTH_CLIENT_ID;
    try {
      const result = await ProviderLogins.GitLabPlugin.methods[0].authorize!({
        instanceUrl: 'https://git.example.com',
      });
      expect(result).toEqual({ type: 'failed' });
    } finally {
      if (previous !== undefined) process.env.GITLAB_OAUTH_CLIENT_ID = previous;
    }
  });

  test('the loader passes the token and instance to gitlab-ai-provider', async () => {
    const loader = ProviderLogins.GitLabPlugin.loader!;
    expect(
      await loader(
        async () => ({
          type: 'oauth',
          access: 'a',
          refresh: 'r',
          expires: Date.now() + 3600_000,
          enterpriseUrl: 'https://git.example.com',
        }),
        {}
      )
    ).toEqual({
      apiKey: 'a',
      options: { instanceUrl: 'https://git.example.com' },
    });
    expect(
      await loader(async () => ({ type: 'api', key: 'glpat-x' }), {})
    ).toEqual({ apiKey: 'glpat-x' });
  });

  test('browser flow: PKCE callback on 127.0.0.1:8080', async () => {
    const realFetch = globalThis.fetch;
    const exchanged: URLSearchParams[] = [];
    globalThis.fetch = (async (input: any, init?: any) => {
      if (String(input) === 'https://gitlab.com/oauth/token') {
        exchanged.push(new URLSearchParams(String(init?.body)));
        return Response.json({
          access_token: 'gl-access',
          refresh_token: 'gl-refresh',
          expires_in: 60,
        });
      }
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      const authorize = (await ProviderLogins.GitLabPlugin.methods[0]
        .authorize!({})) as any;
      // Port 8080 is fixed by the registered redirect URI; skip if taken.
      if (authorize.type === 'failed') return;
      const url = new URL(authorize.url);
      expect(url.origin + url.pathname).toBe(
        'https://gitlab.com/oauth/authorize'
      );
      expect(url.searchParams.get('scope')).toBe('api');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      const pending = authorize.callback();
      const response = await realFetch(
        `${ProviderLogins.GITLAB_REDIRECT_URI}?code=gl-code&state=${url.searchParams.get('state')}`
      );
      expect(response.status).toBe(200);
      expect(await pending).toMatchObject({
        type: 'success',
        provider: 'gitlab',
        access: 'gl-access',
        refresh: 'gl-refresh',
        enterpriseUrl: 'https://gitlab.com',
      });
      expect(exchanged[0].get('code')).toBe('gl-code');
      expect(exchanged[0].get('code_verifier')).toBeTruthy();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('stored subscription logins reach the provider registry', () => {
  test('xAI and GitLab tokens are refreshed, DigitalOcean token is used', async () => {
    const dataHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-334-'));
    try {
      const proc = Bun.spawn(
        ['bun', '../experiments/issue-334/oauth-providers.ts'],
        {
          cwd: path.join(import.meta.dir, '..'),
          env: { ...process.env, XDG_DATA_HOME: dataHome },
          stdout: 'pipe',
          stderr: 'pipe',
        }
      );
      const [output, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      const line = output.split('\n').find((l) => l.startsWith('RESULT '));
      if (!line) throw new Error(`probe failed: ${output}\n${stderr}`);
      const result = JSON.parse(line!.slice('RESULT '.length));
      expect(result.xai).toEqual({ source: 'api', apiKey: true });
      expect(result.digitalocean).toEqual({ source: 'api', apiKey: true });
      expect(result.poe).toEqual({ source: 'api', apiKey: true });
      expect(result.gitlab).toEqual({
        apiKey: true,
        instanceUrl: 'https://gitlab.example.com/root',
      });
      expect(result.storedGitlab).toEqual({
        access: true,
        refresh: true,
        enterpriseUrl: 'https://gitlab.example.com/root',
      });
      expect(result.refreshRequests).toHaveLength(2);
      expect(result.storedXai).toEqual({
        access: true,
        refresh: true,
        fresh: true,
      });
    } finally {
      await fs.rm(dataHome, { recursive: true, force: true });
    }
  }, 60_000);
});
