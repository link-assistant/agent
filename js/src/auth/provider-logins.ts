import crypto from 'crypto';
import * as http from 'node:http';
import { Auth } from './index';
import type { AuthPlugin, AuthResult } from './plugins';
import { Log } from '../util/log';

/**
 * Subscription / account logins OpenCode offers for xAI, Poe and DigitalOcean
 * (https://github.com/anomalyco/opencode, packages/core/src/plugin/provider),
 * ported to the agent's AuthPlugin shape (#334). Each provider also keeps a
 * plain API-key method.
 */
export namespace ProviderLogins {
  const log = Log.create({ service: 'provider-logins' });

  type Fetch = typeof fetch;
  type Sleep = (ms: number) => Promise<void>;
  const sleep: Sleep = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  // No authorize(): the CLI falls back to its masked API-key prompt.
  const apiKeyMethod: AuthPlugin['methods'][number] = {
    label: 'Manually enter API Key',
    type: 'api',
  };

  function positiveSeconds(value: unknown, fallback: number) {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : fallback;
  }

  // ---------------------------------------------------------------- xAI ----

  export const XAI_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
  export const XAI_ISSUER = 'https://auth.x.ai/oauth2';
  const XAI_SCOPE =
    'openid profile email offline_access grok-cli:access api:access';
  const XAI_DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
  const FORM = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };

  export interface XAIToken {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  }

  export interface XAIDevice {
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    expires_in?: number;
    interval?: number;
  }

  /** Expiry from `expires_in`, else from the JWT `exp` claim, else 1h. */
  export function tokenExpiration(token: XAIToken, now = Date.now()) {
    if (token.expires_in) {
      return now + positiveSeconds(token.expires_in, 3600) * 1000;
    }
    const payload = token.access_token.split('.')[1];
    try {
      const exp = payload
        ? JSON.parse(Buffer.from(payload, 'base64url').toString()).exp
        : undefined;
      if (typeof exp === 'number') return exp * 1000;
    } catch {
      // not a JWT
    }
    return now + 3600 * 1000;
  }

  /**
   * Poll the device token endpoint until the user approves, following the
   * RFC 8628 `authorization_pending` / `slow_down` replies.
   */
  export async function pollXAIDevice(
    device: XAIDevice,
    options: { fetchImpl?: Fetch; sleep?: Sleep; now?: () => number } = {}
  ): Promise<XAIToken> {
    const fetchImpl = options.fetchImpl ?? fetch;
    const wait = options.sleep ?? sleep;
    const now = options.now ?? Date.now;
    const expires = now() + positiveSeconds(device.expires_in, 300) * 1000;
    let interval = Math.max(positiveSeconds(device.interval, 5) * 1000, 1000);
    const margin = 3000;
    while (now() < expires) {
      const response = await fetchImpl(`${XAI_ISSUER}/token`, {
        method: 'POST',
        headers: FORM,
        body: new URLSearchParams({
          grant_type: XAI_DEVICE_GRANT,
          client_id: XAI_CLIENT_ID,
          device_code: device.device_code,
        }).toString(),
      });
      if (response.ok) return (await response.json()) as XAIToken;
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        error_description?: string;
      };
      if (body.error === 'authorization_pending') {
        await wait(interval + margin);
        continue;
      }
      if (body.error === 'slow_down') {
        interval += 5000;
        await wait(interval + margin);
        continue;
      }
      if (
        body.error === 'access_denied' ||
        body.error === 'authorization_denied'
      ) {
        throw new Error('xAI device authorization was denied');
      }
      if (body.error === 'expired_token') {
        throw new Error('xAI device code expired - please re-run login');
      }
      const detail = body.error_description ?? body.error;
      throw new Error(
        `xAI device token exchange failed (${response.status})${detail ? `: ${detail}` : ''}`
      );
    }
    throw new Error('xAI device authorization timed out');
  }

  export async function refreshXAI(
    refresh: string,
    fetchImpl: Fetch = fetch
  ): Promise<Extract<Auth.Info, { type: 'oauth' }>> {
    const response = await fetchImpl(`${XAI_ISSUER}/token`, {
      method: 'POST',
      headers: FORM,
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refresh,
        client_id: XAI_CLIENT_ID,
      }).toString(),
    });
    if (!response.ok) {
      throw new Error(`xAI token refresh failed (${response.status})`);
    }
    const token = (await response.json()) as XAIToken;
    return {
      type: 'oauth',
      access: token.access_token,
      refresh: token.refresh_token ?? refresh,
      expires: tokenExpiration(token),
    };
  }

  export const XAIPlugin: AuthPlugin = {
    provider: 'xai',
    methods: [
      {
        label: 'SuperGrok Subscription',
        type: 'oauth',
        async authorize() {
          const response = await fetch(`${XAI_ISSUER}/device/code`, {
            method: 'POST',
            headers: FORM,
            body: new URLSearchParams({
              client_id: XAI_CLIENT_ID,
              scope: XAI_SCOPE,
              referrer: 'link-assistant-agent',
            }).toString(),
          });
          if (!response.ok) {
            log.error(() => ({
              message: 'xai device code request failed',
              status: response.status,
            }));
            return { type: 'failed' as const };
          }
          const device = (await response.json()) as XAIDevice;
          return {
            url: device.verification_uri_complete ?? device.verification_uri,
            instructions: `Open ${device.verification_uri} on any device and enter code: ${device.user_code}`,
            method: 'auto' as const,
            async callback(): Promise<AuthResult> {
              try {
                const token = await pollXAIDevice(device);
                if (!token.refresh_token) {
                  throw new Error(
                    'xAI token response is missing refresh_token'
                  );
                }
                return {
                  type: 'success',
                  provider: 'xai',
                  access: token.access_token,
                  refresh: token.refresh_token,
                  expires: tokenExpiration(token),
                };
              } catch (error) {
                log.error(() => ({
                  message: 'xai login failed',
                  error: String(error),
                }));
                return { type: 'failed' };
              }
            },
          };
        },
      },
      apiKeyMethod,
    ],
    async loader(getAuth) {
      let auth = await getAuth();
      if (auth?.type === 'api') return { apiKey: auth.key };
      if (auth?.type !== 'oauth') return {};
      if (auth.expires <= Date.now() + 60_000) {
        auth = await refreshXAI(auth.refresh);
        await Auth.set('xai', auth);
      }
      return { apiKey: auth.access };
    },
  };

  // ---------------------------------------------------------------- Poe ----

  export const POE_CLIENT_ID = 'client_728290227fc048cc9262091a1ea197ea';
  export const POE_ISSUER = 'https://poe.com';
  const NO_EXPIRY = 8_640_000_000_000_000;

  /** Validate the loopback redirect; returns an error message or undefined. */
  export function poeCallbackError(params: URLSearchParams, state: string) {
    if (params.get('state') !== state) return 'Invalid OAuth state';
    if (params.has('iss') && params.get('iss') !== POE_ISSUER) {
      return 'Invalid OAuth issuer';
    }
    if (params.has('error')) {
      const detail =
        params.get('error_description') ||
        params.get('error') ||
        'Authorization denied';
      return detail.includes(state) ? 'Poe authorization failed' : detail;
    }
    return params.get('code')?.trim()
      ? undefined
      : 'Missing authorization code';
  }

  /** Exchange the code for a Poe-issued API key (`apikey:create` scope). */
  export async function exchangePoeCode(
    input: { code: string; redirect: string; verifier: string },
    fetchImpl: Fetch = fetch,
    now = Date.now()
  ): Promise<{ key: string; expires: number }> {
    const response = await fetchImpl('https://api.poe.com/token', {
      method: 'POST',
      headers: FORM,
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: POE_CLIENT_ID,
        code: input.code,
        redirect_uri: input.redirect,
        code_verifier: input.verifier,
      }).toString(),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        error_description?: string;
      };
      const detail = body.error_description || body.error;
      const leaks =
        detail && [input.code, input.verifier].some((s) => detail.includes(s));
      throw new Error(
        detail && !leaks
          ? `Poe token exchange failed: ${detail}`
          : `Poe token exchange failed (${response.status})`
      );
    }
    const token = (await response.json()) as {
      api_key?: string;
      api_key_expires_in?: number | null;
    };
    const key = token.api_key?.trim();
    if (!key || /\s/.test(key)) throw new Error('Invalid Poe token response');
    const expires =
      token.api_key_expires_in == null
        ? NO_EXPIRY
        : now + token.api_key_expires_in * 1000;
    return { key, expires };
  }

  function page(title: string, message: string, script = '') {
    const escape = (s: string) =>
      s.replace(
        /[&<>"']/g,
        (c) =>
          ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
          })[c]!
      );
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title></head><body><h1 id="h">${escape(title)}</h1><p id="m">${escape(message)}</p>${script ? `<script>${script}</script>` : ''}</body></html>`;
  }

  async function listen(server: http.Server, port: number, host: string) {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Missing OAuth callback port');
    }
    return address.port;
  }

  export const PoePlugin: AuthPlugin = {
    provider: 'poe',
    methods: [
      {
        label: 'Login with Poe (browser)',
        type: 'oauth',
        async authorize() {
          const verifier = crypto.randomBytes(32).toString('base64url');
          const challenge = crypto
            .createHash('sha256')
            .update(verifier)
            .digest('base64url');
          const state = crypto.randomBytes(32).toString('base64url');
          let settle!: (value: { code: string } | Error) => void;
          const received = new Promise<{ code: string } | Error>(
            (resolve) => (settle = resolve)
          );
          const server = http.createServer((request, response) => {
            const url = new URL(request.url ?? '/', 'http://127.0.0.1');
            if (request.method !== 'GET' || url.pathname !== '/callback') {
              response.writeHead(404).end();
              return;
            }
            const error = poeCallbackError(url.searchParams, state);
            response
              .writeHead(error ? 400 : 200, { 'Content-Type': 'text/html' })
              .end(
                error
                  ? page('Authorization failed', error)
                  : page(
                      'Authorization successful',
                      'You can close this window and return to the terminal.'
                    )
              );
            settle(
              error
                ? new Error(error)
                : { code: url.searchParams.get('code')!.trim() }
            );
          });
          const port = await listen(server, 0, '127.0.0.1');
          const redirect = `http://127.0.0.1:${port}/callback`;
          return {
            url: `${POE_ISSUER}/oauth/authorize?${new URLSearchParams({
              response_type: 'code',
              client_id: POE_CLIENT_ID,
              redirect_uri: redirect,
              scope: 'apikey:create',
              code_challenge: challenge,
              code_challenge_method: 'S256',
              state,
            })}`,
            instructions:
              'Complete authorization in your browser. This window will close automatically.',
            method: 'auto' as const,
            async callback(): Promise<AuthResult> {
              try {
                const result = await received;
                if (result instanceof Error) throw result;
                const { key } = await exchangePoeCode({
                  code: result.code,
                  redirect,
                  verifier,
                });
                // Poe returns an API key, stored like a manually entered one.
                return { type: 'success', provider: 'poe', key };
              } catch (error) {
                log.error(() => ({
                  message: 'poe login failed',
                  error: String(error),
                }));
                return { type: 'failed' };
              } finally {
                server.close();
                server.closeAllConnections();
              }
            },
          };
        },
      },
      apiKeyMethod,
    ],
  };

  // -------------------------------------------------------- DigitalOcean ----

  export const DIGITALOCEAN_CLIENT_ID =
    'b1a6c5158156caac821fd1b30253ca8acb52454a48fa744420e41889cb589f82';
  const DIGITALOCEAN_AUTHORIZE =
    'https://cloud.digitalocean.com/v1/oauth/authorize';
  /** The redirect URI registered for the client is fixed to this port. */
  export const DIGITALOCEAN_CALLBACK_PORT = 1456;
  const CALLBACK_PATH = '/auth/callback';
  const TOKEN_PATH = '/auth/token';

  /**
   * DigitalOcean uses the implicit grant: the token arrives in the URL
   * fragment, so a small page posts it back to the loopback server.
   */
  export function digitalOceanBootstrapPage() {
    const script = `var p=new URLSearchParams(location.hash.slice(1));var b={};p.forEach(function(v,k){b[k]=v});new URLSearchParams(location.search).forEach(function(v,k){if(!(k in b))b[k]=v});fetch(${JSON.stringify(TOKEN_PATH)},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json()}).then(function(j){document.getElementById('h').textContent=j.ok?'Authorization successful':'Authorization failed';document.getElementById('m').textContent=j.ok?'You can close this window.':(j.error||'')}).catch(function(e){document.getElementById('m').textContent=String(e)})`;
    return page(
      'Finishing sign-in',
      'Completing your DigitalOcean authorization.',
      script
    );
  }

  /** Parse the posted fragment. Returns the token or an error message. */
  export function parseDigitalOceanToken(
    raw: string,
    state: string
  ): { access: string; expiresIn: number } | { error: string } {
    let body: Record<string, string | undefined> = {};
    try {
      body = JSON.parse(raw);
    } catch {
      // handled below
    }
    const error = body.error_description || body.error;
    if (error) return { error };
    if (!body.access_token) return { error: 'Missing access token' };
    if (body.state !== state) return { error: 'Invalid OAuth state' };
    const expires = Number.parseInt(body.expires_in ?? '0', 10);
    return {
      access: body.access_token,
      expiresIn:
        Number.isFinite(expires) && expires > 0 ? expires : 60 * 60 * 24 * 30,
    };
  }

  export const DigitalOceanPlugin: AuthPlugin = {
    provider: 'digitalocean',
    methods: [
      {
        label: 'Login with DigitalOcean',
        type: 'oauth',
        async authorize() {
          const state = crypto.randomBytes(32).toString('base64url');
          let settle!: (
            value: { access: string; expiresIn: number } | Error
          ) => void;
          const received = new Promise<
            { access: string; expiresIn: number } | Error
          >((resolve) => (settle = resolve));
          const server = http.createServer((request, response) => {
            const url = new URL(request.url ?? '/', 'http://localhost');
            if (request.method === 'GET' && url.pathname === CALLBACK_PATH) {
              response
                .writeHead(200, { 'Content-Type': 'text/html' })
                .end(digitalOceanBootstrapPage());
              return;
            }
            if (request.method === 'POST' && url.pathname === TOKEN_PATH) {
              const chunks: Buffer[] = [];
              request.on('data', (chunk: Buffer) => chunks.push(chunk));
              request.on('end', () => {
                const parsed = parseDigitalOceanToken(
                  Buffer.concat(chunks).toString('utf8'),
                  state
                );
                const failed = 'error' in parsed;
                response
                  .writeHead(failed ? 400 : 200, {
                    'Content-Type': 'application/json',
                  })
                  .end(
                    JSON.stringify(
                      failed ? { error: parsed.error } : { ok: true }
                    )
                  );
                settle(failed ? new Error(parsed.error) : parsed);
              });
              return;
            }
            response.writeHead(404).end('Not found');
          });
          try {
            await listen(server, DIGITALOCEAN_CALLBACK_PORT, 'localhost');
          } catch (error: any) {
            log.error(() => ({
              message:
                error?.code === 'EADDRINUSE'
                  ? `DigitalOcean login needs local port ${DIGITALOCEAN_CALLBACK_PORT}, but it is already in use`
                  : 'digitalocean callback server failed',
              error: String(error),
            }));
            return { type: 'failed' as const };
          }
          const redirect = `http://localhost:${DIGITALOCEAN_CALLBACK_PORT}${CALLBACK_PATH}`;
          return {
            url: `${DIGITALOCEAN_AUTHORIZE}?${new URLSearchParams({
              response_type: 'token',
              client_id: DIGITALOCEAN_CLIENT_ID,
              redirect_uri: redirect,
              scope: 'genai:read inference:query',
              state,
            })}`,
            instructions:
              'Complete authorization in your browser. This window will close automatically.',
            method: 'auto' as const,
            async callback(): Promise<AuthResult> {
              try {
                const result = await received;
                if (result instanceof Error) throw result;
                return {
                  type: 'success',
                  provider: 'digitalocean',
                  access: result.access,
                  refresh: '',
                  expires: Date.now() + result.expiresIn * 1000,
                };
              } catch (error) {
                log.error(() => ({
                  message: 'digitalocean login failed',
                  error: String(error),
                }));
                return { type: 'failed' };
              } finally {
                server.close();
                server.closeAllConnections();
              }
            },
          };
        },
      },
      apiKeyMethod,
    ],
    async loader(getAuth) {
      const auth = await getAuth();
      if (auth?.type === 'api') return { apiKey: auth.key };
      if (auth?.type !== 'oauth') return {};
      if (auth.expires && auth.expires <= Date.now()) {
        log.warn(() => ({
          message:
            'DigitalOcean login expired; run `agent auth login digitalocean` again',
        }));
        return {};
      }
      return { apiKey: auth.access };
    },
  };
}
