import { Auth } from './index';
import type { AuthPlugin } from './plugins';
import { Log } from '../util/log';

/**
 * Microsoft Entra ID login for Azure OpenAI / AI Services through the Azure
 * CLI session, ported from OpenCode's Azure plugin
 * (https://github.com/anomalyco/opencode,
 * packages/core/src/plugin/provider/azure.ts) (#334).
 *
 * Like OpenCode, no token is stored: `agent auth login` remembers the
 * resource name, and every request mints (and caches) a bearer token with
 * `az account get-access-token` for the scope of the target URL.
 */
export namespace AzureLogin {
  const log = Log.create({ service: 'azure-login' });

  export const COGNITIVE_SCOPE = 'https://cognitiveservices.azure.com/.default';
  export const FOUNDRY_SCOPE = 'https://ai.azure.com/.default';
  /** Stored in `refresh` to mark an Azure CLI login. */
  export const CLI_MARKER = 'azure-cli';
  /**
   * `@ai-sdk/azure` insists on an API key; requests replace the resulting
   * `api-key` header with the Entra bearer token.
   */
  export const PLACEHOLDER_KEY = 'azure-entra-id';
  // A resource name becomes a hostname label, so nothing else is accepted.
  export const RESOURCE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;
  const REFRESH_MARGIN_MS = 5 * 60_000;
  const TIMEOUT_MS = 10_000;

  export type Run = (args: string[]) => Promise<string>;

  /** Run the Azure CLI and return stdout; fails with its stderr. */
  export const runAz: Run = async (args) => {
    const proc = Bun.spawn(['az', ...args], {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      env: process.env,
    });
    const timer = setTimeout(() => proc.kill(), TIMEOUT_MS);
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (code !== 0) {
        throw new Error(
          `az ${args.slice(0, 2).join(' ')} failed: ${stderr.trim() || `exit ${code}`}`
        );
      }
      return stdout;
    } finally {
      clearTimeout(timer);
    }
  };

  export function parseToken(stdout: string): {
    access: string;
    expires: number;
  } {
    const data = JSON.parse(stdout);
    if (typeof data?.accessToken !== 'string' || !data.accessToken) {
      throw new Error('Azure CLI returned no access token');
    }
    const expires =
      typeof data.expires_on === 'number'
        ? data.expires_on * 1000
        : Date.parse(data.expiresOn ?? '');
    if (!Number.isFinite(expires)) {
      throw new Error('Azure CLI returned an invalid token expiration');
    }
    return { access: data.accessToken, expires };
  }

  /** Token getter with a per-scope cache refreshed 5 minutes early. */
  export function tokenSource(
    run: Run = runAz,
    now: () => number = Date.now
  ): (scope: string) => Promise<string> {
    const cache = new Map<string, { access: string; expires: number }>();
    const pending = new Map<string, Promise<string>>();
    return (scope) => {
      const cached = cache.get(scope);
      if (cached && cached.expires - now() > REFRESH_MARGIN_MS) {
        return Promise.resolve(cached.access);
      }
      const inflight = pending.get(scope);
      if (inflight) return inflight;
      const request = run([
        'account',
        'get-access-token',
        '--scope',
        scope,
        '--output',
        'json',
      ])
        .then((stdout) => {
          const token = parseToken(stdout);
          cache.set(scope, token);
          return token.access;
        })
        .finally(() => pending.delete(scope));
      pending.set(scope, request);
      return request;
    };
  }

  /** Foundry project endpoints use their own audience, like OpenCode. */
  export function scopeFor(url: string): string {
    const target = new URL(url);
    return target.hostname.endsWith('.services.ai.azure.com') &&
      !target.pathname.startsWith('/models')
      ? FOUNDRY_SCOPE
      : COGNITIVE_SCOPE;
  }

  /** Swap the `api-key` header for an Entra bearer token. */
  export function entraFetch(
    token: (scope: string) => Promise<string>,
    base: typeof fetch = fetch
  ): typeof fetch {
    return (async (input: any, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined)
      );
      headers.delete('api-key');
      headers.delete('x-api-key');
      headers.set('authorization', `Bearer ${await token(scopeFor(url))}`);
      return base(input, { ...init, headers });
    }) as typeof fetch;
  }

  export function isCliLogin(info: Auth.Info | undefined): boolean {
    return info?.type === 'oauth' && info.refresh === CLI_MARKER;
  }

  /**
   * SDK options for a stored Azure CLI login, or undefined if there is none.
   * Used by the `azure` custom loader in provider.ts.
   */
  export async function options(
    info?: Auth.Info,
    token: (scope: string) => Promise<string> = defaultToken()
  ): Promise<Record<string, any> | undefined> {
    if (!isCliLogin(info) || info?.type !== 'oauth') return undefined;
    const resourceName =
      info.enterpriseUrl || process.env['AZURE_RESOURCE_NAME'];
    if (!resourceName || !RESOURCE_PATTERN.test(resourceName)) {
      log.warn(() => ({
        message: 'Azure CLI login has no valid resource name, ignoring it',
      }));
      return undefined;
    }
    return {
      resourceName,
      apiKey: PLACEHOLDER_KEY,
      fetch: entraFetch(token),
    };
  }

  let shared: ((scope: string) => Promise<string>) | undefined;
  function defaultToken() {
    return (shared ??= tokenSource());
  }

  export function makePlugin(run: Run = runAz): AuthPlugin {
    return {
      provider: 'azure',
      methods: [
        {
          label: 'Microsoft Entra ID (Azure CLI)',
          type: 'oauth',
          prompts: [
            {
              type: 'text',
              key: 'resourceName',
              message: 'Azure OpenAI or AI Services resource name',
              placeholder: process.env['AZURE_RESOURCE_NAME'] || 'my-models',
              validate: (value) =>
                !value && process.env['AZURE_RESOURCE_NAME']
                  ? undefined
                  : RESOURCE_PATTERN.test(value)
                    ? undefined
                    : 'Use letters, digits and hyphens only',
            },
          ],
          async authorize(inputs = {}) {
            const resourceName =
              inputs['resourceName']?.trim() ||
              process.env['AZURE_RESOURCE_NAME']?.trim() ||
              '';
            if (!RESOURCE_PATTERN.test(resourceName)) {
              log.error(() => ({ message: 'invalid Azure resource name' }));
              return { type: 'failed' as const };
            }
            return {
              url: '',
              instructions:
                'Using your Azure CLI session (`az login`) for Microsoft Entra ID.',
              method: 'auto' as const,
              async callback() {
                try {
                  // Prove the CLI session works before saving the login.
                  await tokenSource(run)(COGNITIVE_SCOPE);
                } catch (error) {
                  log.error(() => ({
                    message:
                      'Azure CLI token request failed; install the Azure CLI and run `az login`',
                    error:
                      error instanceof Error ? error.message : String(error),
                  }));
                  return { type: 'failed' as const };
                }
                return {
                  type: 'success' as const,
                  provider: 'azure',
                  refresh: CLI_MARKER,
                  access: '',
                  expires: 0,
                  enterpriseUrl: resourceName,
                };
              },
            };
          },
        },
        { label: 'Manually enter API Key', type: 'api' },
      ],
    };
  }

  export const Plugin = makePlugin();
}
