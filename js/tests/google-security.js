/* global AbortSignal */
import { describe, expect, test } from 'bun:test';
import { GooglePlugin } from '../src/auth/google-plugin';
import { AuthPlugins } from '../src/auth/plugins';
import { transformToCloudCodeUrl } from '../src/auth/google-security';
import { URL } from 'node:url';

describe('Google OAuth security (#340 review)', () => {
  test('real callback displays untrusted errors as text and terminates authentication', async () => {
    const flow = await GooglePlugin.methods[0].authorize();
    // Attach the rejection handler before sending the error callback.
    const completed = flow.callback();
    const url = new URL(new URL(flow.url).searchParams.get('redirect_uri'));
    const error = '<script>injected()</script><b>error</b>&"\'';
    url.searchParams.set('error', error);
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain('&lt;script&gt;injected()&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;error&lt;/b&gt;&amp;&quot;&#39;');
    expect(html).not.toContain('<script>');
    expect(await completed).toEqual({ type: 'failed' });
  }, 10000);

  test.each([
    'https://generativelanguage.googleapis.com.attacker.invalid',
    'https://attacker-generativelanguage.googleapis.com',
    'https://generativelanguage.googleapis.com@attacker.invalid',
    'http://generativelanguage.googleapis.com',
    'https://attacker.invalid/?host=generativelanguage.googleapis.com',
    'not a URL',
  ])('rejects a lookalike or unsupported API origin: %s', (origin) => {
    expect(
      transformToCloudCodeUrl(`${origin}/v1/models/a:generateContent`)
    ).toBeNull();
  });

  test('uses the exact Google host and preserves configured Cloud Code routing', () => {
    expect(
      transformToCloudCodeUrl(
        'https://GENERATIVELANGUAGE.GOOGLEAPIS.COM/v1/models/a:streamGenerateContent?alt=sse',
        'https://cloudcode.example',
        'v1test'
      )
    ).toBe('https://cloudcode.example/v1test:streamGenerateContent');
  });

  test.each(['google', 'openai'])(
    'OAuth initialization retains shared PKCE helpers for %s',
    async (provider) => {
      const plugin = AuthPlugins.getPlugin(provider);
      // Google manual code entry; other providers initialize without a local server.
      const method = plugin.methods[provider === 'google' ? 1 : 0];
      const flow = await method.authorize();
      const url = new URL(flow.url);
      expect(url.searchParams.get('code_challenge')).toBeTruthy();
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('state')).toBeTruthy();
    }
  );
});
