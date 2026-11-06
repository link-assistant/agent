import * as http from 'node:http';
import * as net from 'node:net';
import { Auth } from './index';
import type { AuthPlugin, AuthResult } from './plugin-types';
import { log, verboseFetch, generatePKCE } from './plugin-utils';

const GOOGLE_OAUTH_CLIENT_ID =
  '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';
const GOOGLE_OAUTH_CLIENT_SECRET = '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';
const GOOGLE_OAUTH_SCOPES = [
  // Note: We intentionally do NOT include generative-language.* scopes here
  // because they are not registered for the Gemini CLI OAuth client (see issue #93).
  // Instead, we rely on the fallback mechanism to use API keys when OAuth fails
  // with scope errors (see issue #100).
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

// Google OAuth endpoints
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

/**
 * Get an available port for the OAuth callback server.
 * Supports configurable port via OAUTH_CALLBACK_PORT or GOOGLE_OAUTH_CALLBACK_PORT
 * environment variable. Falls back to automatic port discovery (port 0) if not configured.
 *
 * Based on Gemini CLI implementation:
 * https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/oauth2.ts
 */
async function getGoogleOAuthPort(): Promise<number> {
  // Check for environment variable override (useful for containers/firewalls)
  // Support both OAUTH_CALLBACK_PORT (Gemini CLI style) and GOOGLE_OAUTH_CALLBACK_PORT
  const portStr =
    process.env['OAUTH_CALLBACK_PORT'] ||
    process.env['GOOGLE_OAUTH_CALLBACK_PORT'];
  if (portStr) {
    const port = parseInt(portStr, 10);
    if (!isNaN(port) && port > 0 && port <= 65535) {
      log.info(() => ({
        message: 'using configured oauth callback port',
        port,
      }));
      return port;
    }
    log.warn(() => ({
      message: 'invalid OAUTH_CALLBACK_PORT, using auto discovery',
      value: portStr,
    }));
  }

  // Discover an available port by binding to port 0
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const address = server.address() as net.AddressInfo;
      const port = address.port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

/**
 * Check if browser launch should be suppressed.
 * When NO_BROWSER=true, use manual code entry flow instead of localhost redirect.
 *
 * Based on Gemini CLI's config.isBrowserLaunchSuppressed() functionality.
 */
function isBrowserSuppressed(): boolean {
  const noBrowser = process.env['NO_BROWSER'];
  return noBrowser === 'true' || noBrowser === '1';
}

/**
 * Get the OAuth callback host for server binding.
 * Defaults to 'localhost' but can be configured via OAUTH_CALLBACK_HOST.
 * Use '0.0.0.0' in Docker containers to allow external connections.
 */
function getOAuthCallbackHost(): string {
  return process.env['OAUTH_CALLBACK_HOST'] || 'localhost';
}

/**
 * Google Code Assist redirect URI for manual code entry flow
 * This is used when NO_BROWSER=true or in headless environments
 * Based on Gemini CLI implementation
 */
const GOOGLE_CODEASSIST_REDIRECT_URI = 'https://codeassist.google.com/authcode';

/**
 * Google OAuth Plugin
 * Supports:
 * - Google AI Pro/Ultra OAuth login (browser mode with localhost redirect)
 * - Google AI Pro/Ultra OAuth login (manual code entry for NO_BROWSER mode)
 * - Manual API key entry
 *
 * Note: This plugin uses OAuth 2.0 with PKCE for Google AI subscription authentication.
 * After authenticating, you can use Gemini models with subscription benefits.
 *
 * The OAuth flow supports two modes:
 * 1. Browser mode (default): Opens browser, uses localhost redirect server
 * 2. Manual code entry (NO_BROWSER=true): Shows URL, user pastes authorization code
 *
 * Based on Gemini CLI implementation:
 * https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/oauth2.ts
 */
export const GooglePlugin: AuthPlugin = {
  provider: 'google',
  methods: [
    {
      label: 'Google AI Pro/Ultra (OAuth - Browser)',
      type: 'oauth',
      async authorize() {
        // Check if browser is suppressed - if so, recommend manual method
        if (isBrowserSuppressed()) {
          log.info(() => ({
            message: 'NO_BROWSER is set, use manual code entry method instead',
          }));
        }

        const pkce = await generatePKCE();
        const state = generateRandomString(16);

        // Get an available port BEFORE starting the server
        // This fixes the race condition where port was 0 when building redirect URI
        const serverPort = await getGoogleOAuthPort();
        const host = getOAuthCallbackHost();
        // The redirect URI sent to Google must use localhost (loopback IP)
        // even if we bind to a different host (like 0.0.0.0 in Docker)
        const redirectUri = `http://localhost:${serverPort}/oauth/callback`;

        log.info(() => ({
          message: 'starting google oauth server',
          port: serverPort,
          host,
          redirectUri,
        }));

        // Create server to handle OAuth redirect
        const server = http.createServer();

        const authPromise = new Promise<{ code: string; state: string }>(
          (resolve, reject) => {
            server.on('request', (req, res) => {
              const url = new URL(req.url!, `http://localhost:${serverPort}`);
              const code = url.searchParams.get('code');
              const receivedState = url.searchParams.get('state');
              const error = url.searchParams.get('error');

              if (error) {
                res.writeHead(400, { 'Content-Type': 'text/html' });
                res.end(`
                <html>
                  <body>
                    <h1>Authentication Failed</h1>
                    <p>Error: ${error}</p>
                    <p>You can close this window.</p>
                  </body>
                </html>
              `);
                server.close();
                reject(new Error(`OAuth error: ${error}`));
                return;
              }

              if (code && receivedState) {
                if (receivedState !== state) {
                  res.writeHead(400, { 'Content-Type': 'text/html' });
                  res.end('Invalid state parameter');
                  server.close();
                  reject(new Error('State mismatch - possible CSRF attack'));
                  return;
                }

                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(`
                <html>
                  <body>
                    <h1>Authentication Successful!</h1>
                    <p>You can close this window and return to the terminal.</p>
                    <script>window.close();</script>
                  </body>
                </html>
              `);
                server.close();
                resolve({ code, state: receivedState });
                return;
              }

              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end('Missing code or state parameter');
            });

            // Listen on the configured host and pre-determined port
            server.listen(serverPort, host, () => {
              log.info(() => ({
                message: 'google oauth server listening',
                port: serverPort,
                host,
              }));
            });

            server.on('error', (err) => {
              log.error(() => ({
                message: 'google oauth server error',
                error: err,
              }));
              reject(err);
            });

            // Timeout after 5 minutes
            setTimeout(
              () => {
                server.close();
                reject(new Error('OAuth timeout'));
              },
              5 * 60 * 1000
            );
          }
        );

        // Build authorization URL with the redirect URI
        const url = new URL(GOOGLE_AUTH_URL);
        url.searchParams.set('client_id', GOOGLE_OAUTH_CLIENT_ID);
        url.searchParams.set('redirect_uri', redirectUri);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('scope', GOOGLE_OAUTH_SCOPES.join(' '));
        url.searchParams.set('access_type', 'offline');
        url.searchParams.set('code_challenge', pkce.challenge);
        url.searchParams.set('code_challenge_method', 'S256');
        url.searchParams.set('state', state);
        url.searchParams.set('prompt', 'consent');

        return {
          url: url.toString(),
          instructions:
            'Your browser will open for authentication. Complete the login and return to the terminal.',
          method: 'auto' as const,
          async callback(): Promise<AuthResult> {
            try {
              const { code } = await authPromise;

              // Exchange authorization code for tokens
              const tokenResult = await verboseFetch(GOOGLE_TOKEN_URL, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                  code: code,
                  client_id: GOOGLE_OAUTH_CLIENT_ID,
                  client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
                  redirect_uri: redirectUri,
                  grant_type: 'authorization_code',
                  code_verifier: pkce.verifier,
                }),
              });

              if (!tokenResult.ok) {
                log.error(() => ({
                  message: 'google oauth token exchange failed',
                  status: tokenResult.status,
                }));
                return { type: 'failed' };
              }

              const json = await tokenResult.json();
              if (
                !json.access_token ||
                !json.refresh_token ||
                typeof json.expires_in !== 'number'
              ) {
                log.error(() => ({
                  message: 'google oauth token response missing fields',
                }));
                return { type: 'failed' };
              }

              return {
                type: 'success',
                refresh: json.refresh_token,
                access: json.access_token,
                expires: Date.now() + json.expires_in * 1000,
              };
            } catch (error) {
              log.error(() => ({ message: 'google oauth failed', error }));
              return { type: 'failed' };
            }
          },
        };
      },
    },
    {
      label: 'Google AI Pro/Ultra (OAuth - Manual Code Entry)',
      type: 'oauth',
      async authorize() {
        /**
         * Manual code entry flow for headless environments or when NO_BROWSER=true
         * Uses Google's Code Assist redirect URI which displays the auth code to the user
         *
         * Based on Gemini CLI's authWithUserCode function:
         * https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/oauth2.ts
         */
        const pkce = await generatePKCE();
        const state = generateRandomString(16);
        const redirectUri = GOOGLE_CODEASSIST_REDIRECT_URI;

        log.info(() => ({
          message: 'using manual code entry oauth flow',
          redirectUri,
        }));

        // Build authorization URL with the Code Assist redirect URI
        const url = new URL(GOOGLE_AUTH_URL);
        url.searchParams.set('client_id', GOOGLE_OAUTH_CLIENT_ID);
        url.searchParams.set('redirect_uri', redirectUri);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('scope', GOOGLE_OAUTH_SCOPES.join(' '));
        url.searchParams.set('access_type', 'offline');
        url.searchParams.set('code_challenge', pkce.challenge);
        url.searchParams.set('code_challenge_method', 'S256');
        url.searchParams.set('state', state);
        url.searchParams.set('prompt', 'consent');

        return {
          url: url.toString(),
          instructions:
            'Visit the URL above, complete authorization, then paste the authorization code here: ',
          method: 'code' as const,
          async callback(code?: string): Promise<AuthResult> {
            if (!code) {
              log.error(() => ({
                message: 'google oauth no code provided',
              }));
              return { type: 'failed' };
            }

            try {
              // Exchange authorization code for tokens
              const tokenResult = await verboseFetch(GOOGLE_TOKEN_URL, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                  code: code.trim(),
                  client_id: GOOGLE_OAUTH_CLIENT_ID,
                  client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
                  redirect_uri: redirectUri,
                  grant_type: 'authorization_code',
                  code_verifier: pkce.verifier,
                }),
              });

              if (!tokenResult.ok) {
                const errorText = await tokenResult.text();
                log.error(() => ({
                  message: 'google oauth token exchange failed',
                  status: tokenResult.status,
                  error: errorText,
                }));
                return { type: 'failed' };
              }

              const json = await tokenResult.json();
              if (
                !json.access_token ||
                !json.refresh_token ||
                typeof json.expires_in !== 'number'
              ) {
                log.error(() => ({
                  message: 'google oauth token response missing fields',
                }));
                return { type: 'failed' };
              }

              return {
                type: 'success',
                refresh: json.refresh_token,
                access: json.access_token,
                expires: Date.now() + json.expires_in * 1000,
              };
            } catch (error) {
              log.error(() => ({
                message: 'google oauth manual code entry failed',
                error,
              }));
              return { type: 'failed' };
            }
          },
        };
      },
    },
    {
      label: 'Manually enter API Key',
      type: 'api',
    },
  ],
  async loader(getAuth, provider) {
    const auth = await getAuth();
    if (!auth || auth.type !== 'oauth') return {};

    // Zero out cost for subscription users
    if (provider?.models) {
      for (const model of Object.values(provider.models)) {
        (model as any).cost = {
          input: 0,
          output: 0,
          cache: {
            read: 0,
            write: 0,
          },
        };
      }
    }

    /**
     * Cloud Code API Configuration
     *
     * The official Gemini CLI uses Google's Cloud Code API (cloudcode-pa.googleapis.com)
     * instead of the standard Generative Language API (generativelanguage.googleapis.com).
     *
     * The Cloud Code API:
     * 1. Accepts `cloud-platform` OAuth scope (unlike generativelanguage.googleapis.com)
     * 2. Handles subscription tier validation (FREE, STANDARD, etc.)
     * 3. Proxies requests to the Generative Language API internally
     *
     * @see https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/server.ts
     * @see https://github.com/link-assistant/agent/issues/100
     * @see https://github.com/link-assistant/agent/issues/102
     */
    const CLOUD_CODE_ENDPOINT =
      process.env['CODE_ASSIST_ENDPOINT'] ||
      'https://cloudcode-pa.googleapis.com';
    const CLOUD_CODE_API_VERSION =
      process.env['CODE_ASSIST_API_VERSION'] || 'v1internal';

    /**
     * Synthetic thought signature used for Gemini 3+ function calls.
     * The Cloud Code API requires function call parts in the active loop
     * to have a thoughtSignature. This bypass value is accepted by the API.
     *
     * @see https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/core/geminiChat.ts
     */
    const SYNTHETIC_THOUGHT_SIGNATURE = 'skip_thought_signature_validator';

    /**
     * Retry configuration for transient Cloud Code API errors.
     * Matches patterns from Gemini CLI and opencode-gemini-auth plugin.
     */
    const MAX_RETRIES = 2;
    const RETRY_BASE_DELAY_MS = 800;
    const RETRY_MAX_DELAY_MS = 8000;

    /**
     * Cached project context from Cloud Code API onboarding.
     * Persists across requests to avoid repeated loadCodeAssist calls.
     * Keyed by refresh token to invalidate when auth changes.
     */
    let cachedProjectContext: {
      projectId?: string;
      refreshToken: string;
    } | null = null;

    log.debug(() => ({
      message: 'google oauth loader initialized',
      cloudCodeEndpoint: CLOUD_CODE_ENDPOINT,
      apiVersion: CLOUD_CODE_API_VERSION,
    }));

    /**
     * Ensure project context is available for Cloud Code API requests.
     * Calls loadCodeAssist to check user tier and onboards if necessary.
     * Results are cached to avoid repeated API calls.
     *
     * @see https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/setup.ts
     */
    const ensureProjectContext = async (
      accessToken: string,
      refreshToken: string
    ): Promise<string | undefined> => {
      // Check for explicit project ID from environment
      const envProjectId =
        process.env['GOOGLE_CLOUD_PROJECT'] ||
        process.env['GOOGLE_CLOUD_PROJECT_ID'];
      if (envProjectId) {
        return envProjectId;
      }

      // Return cached context if still valid (same refresh token)
      if (
        cachedProjectContext &&
        cachedProjectContext.refreshToken === refreshToken
      ) {
        return cachedProjectContext.projectId;
      }

      // Call loadCodeAssist to discover project and tier
      try {
        const loadUrl = `${CLOUD_CODE_ENDPOINT}/${CLOUD_CODE_API_VERSION}:loadCodeAssist`;
        const loadRes = await verboseFetch(loadUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            metadata: {
              ideType: 'IDE_UNSPECIFIED',
              platform: 'PLATFORM_UNSPECIFIED',
              pluginType: 'GEMINI',
            },
          }),
        });

        if (!loadRes.ok) {
          const errorText = await loadRes.text().catch(() => 'unknown');
          log.warn(() => ({
            message: 'loadCodeAssist failed, proceeding without project',
            status: loadRes.status,
            error: errorText.substring(0, 200),
          }));
          // Cache empty result to avoid retrying on every request
          cachedProjectContext = { refreshToken };
          return undefined;
        }

        const loadData = await loadRes.json();
        log.debug(() => ({
          message: 'loadCodeAssist response',
          hasCurrentTier: !!loadData.currentTier,
          tierId: loadData.currentTier?.id,
          hasProject: !!loadData.cloudaicompanionProject,
        }));

        // If user already has a tier and project, use it
        if (loadData.currentTier && loadData.cloudaicompanionProject) {
          cachedProjectContext = {
            projectId: loadData.cloudaicompanionProject,
            refreshToken,
          };
          log.info(() => ({
            message: 'user already onboarded',
            tier: loadData.currentTier.id,
            projectId: loadData.cloudaicompanionProject,
          }));
          return loadData.cloudaicompanionProject;
        }

        // If user has a tier but no project, and paidTier exists
        if (loadData.currentTier) {
          cachedProjectContext = { refreshToken };
          return undefined;
        }

        // User needs onboarding - find default tier
        let targetTierId = 'free-tier';
        for (const tier of loadData.allowedTiers || []) {
          if (tier.isDefault) {
            targetTierId = tier.id;
            break;
          }
        }

        log.info(() => ({
          message: 'onboarding user to tier',
          tier: targetTierId,
        }));

        // Call onboardUser
        const onboardUrl = `${CLOUD_CODE_ENDPOINT}/${CLOUD_CODE_API_VERSION}:onboardUser`;
        const onboardReq =
          targetTierId === 'free-tier'
            ? {
                tierId: targetTierId,
                metadata: {
                  ideType: 'IDE_UNSPECIFIED',
                  platform: 'PLATFORM_UNSPECIFIED',
                  pluginType: 'GEMINI',
                },
              }
            : {
                tierId: targetTierId,
                cloudaicompanionProject: envProjectId,
                metadata: {
                  ideType: 'IDE_UNSPECIFIED',
                  platform: 'PLATFORM_UNSPECIFIED',
                  pluginType: 'GEMINI',
                  duetProject: envProjectId,
                },
              };

        let lroRes = await verboseFetch(onboardUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(onboardReq),
        }).then((r) => r.json());

        // Poll until onboarding completes (max 10 attempts)
        let attempts = 0;
        while (!lroRes.done && attempts < 10) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          if (lroRes.name) {
            // Poll operation status
            const opUrl = `${CLOUD_CODE_ENDPOINT}/${CLOUD_CODE_API_VERSION}/${lroRes.name}`;
            lroRes = await verboseFetch(opUrl, {
              headers: { Authorization: `Bearer ${accessToken}` },
            }).then((r) => r.json());
          } else {
            lroRes = await verboseFetch(onboardUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify(onboardReq),
            }).then((r) => r.json());
          }
          attempts++;
        }

        const projectId =
          lroRes.response?.cloudaicompanionProject?.id || undefined;
        cachedProjectContext = { projectId, refreshToken };

        log.info(() => ({
          message: 'user onboarding complete',
          projectId,
          attempts,
        }));

        return projectId;
      } catch (error) {
        log.warn(() => ({
          message: 'project context setup failed, proceeding without project',
          error: String(error),
        }));
        cachedProjectContext = { refreshToken };
        return undefined;
      }
    };

    /**
     * Check if we have a fallback API key available.
     * This allows trying API key authentication if Cloud Code API fails.
     * See: https://github.com/link-assistant/agent/issues/100
     */
    const getFallbackApiKey = (): string | undefined => {
      const envKey =
        process.env['GOOGLE_GENERATIVE_AI_API_KEY'] ||
        process.env['GEMINI_API_KEY'];

      if (envKey) {
        log.debug(() => ({
          message: 'fallback api key available',
          source: process.env['GOOGLE_GENERATIVE_AI_API_KEY']
            ? 'GOOGLE_GENERATIVE_AI_API_KEY'
            : 'GEMINI_API_KEY',
          keyLength: envKey.length,
        }));
        return envKey;
      }

      return undefined;
    };

    /**
     * Detect if an error is a scope-related authentication error.
     */
    const isScopeError = (response: Response): boolean => {
      if (response.status !== 403) return false;
      const wwwAuth = response.headers.get('www-authenticate') || '';
      const isScope =
        wwwAuth.includes('insufficient_scope') ||
        wwwAuth.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT');

      if (isScope) {
        log.debug(() => ({
          message: 'detected oauth scope error',
          status: response.status,
          wwwAuthenticate: wwwAuth.substring(0, 200),
        }));
      }

      return isScope;
    };

    /**
     * Check if a response status is retryable (transient error).
     * Includes 500/502 for intermittent server errors (#231).
     */
    const isRetryableStatus = (status: number): boolean => {
      return (
        status === 429 || status === 500 || status === 502 || status === 503
      );
    };

    /**
     * Extract retry delay from response headers or error body.
     */
    const getRetryDelay = (response: Response, attempt: number): number => {
      // Check Retry-After header
      const retryAfter = response.headers.get('retry-after');
      if (retryAfter) {
        const seconds = parseInt(retryAfter, 10);
        if (!isNaN(seconds)) return seconds * 1000;
      }

      // Check retry-after-ms header
      const retryAfterMs = response.headers.get('retry-after-ms');
      if (retryAfterMs) {
        const ms = parseInt(retryAfterMs, 10);
        if (!isNaN(ms)) return ms;
      }

      // Exponential backoff
      const delay = Math.min(
        RETRY_BASE_DELAY_MS * Math.pow(2, attempt),
        RETRY_MAX_DELAY_MS
      );
      return delay;
    };

    /**
     * Transform a Generative Language API URL to Cloud Code API URL
     *
     * Input:  https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent
     * Output: https://cloudcode-pa.googleapis.com/v1internal:generateContent
     */
    const transformToCloudCodeUrl = (url: string): string | null => {
      try {
        const parsed = new URL(url);
        if (!parsed.hostname.includes('generativelanguage.googleapis.com')) {
          log.debug(() => ({
            message:
              'url is not generativelanguage api, skipping cloud code transform',
            hostname: parsed.hostname,
          }));
          return null;
        }

        const pathMatch = parsed.pathname.match(/:(\w+)$/);
        if (!pathMatch) {
          log.debug(() => ({
            message: 'could not extract method from url path',
            pathname: parsed.pathname,
          }));
          return null;
        }

        const method = pathMatch[1];
        const cloudCodeUrl = `${CLOUD_CODE_ENDPOINT}/${CLOUD_CODE_API_VERSION}:${method}`;

        log.debug(() => ({
          message: 'transformed url to cloud code api',
          originalUrl: url.substring(0, 100),
          method,
          cloudCodeUrl,
        }));

        return cloudCodeUrl;
      } catch (error) {
        log.debug(() => ({
          message: 'failed to parse url for cloud code transform',
          url: url.substring(0, 100),
          error: String(error),
        }));
        return null;
      }
    };

    /**
     * Check if a URL is for a streaming request.
     * The AI SDK appends alt=sse for streaming or uses streamGenerateContent method.
     */
    const isStreamingRequest = (url: string): boolean => {
      return url.includes('streamGenerateContent') || url.includes('alt=sse');
    };

    /**
     * Extract model name from Generative Language API URL
     *
     * Input:  https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent
     * Output: gemini-2.0-flash
     */
    const extractModelFromUrl = (url: string): string | null => {
      try {
        const parsed = new URL(url);
        const pathMatch = parsed.pathname.match(/\/models\/([^:]+):/);
        const model = pathMatch ? pathMatch[1] : null;

        log.debug(() => ({
          message: 'extracted model from url',
          pathname: parsed.pathname,
          model,
        }));

        return model;
      } catch (error) {
        log.debug(() => ({
          message: 'failed to extract model from url',
          url: url.substring(0, 100),
          error: String(error),
        }));
        return null;
      }
    };

    /**
     * Inject thoughtSignature into function call parts for Gemini 3+ models.
     *
     * The Cloud Code API requires function call parts in model turns within
     * the active loop to have a `thoughtSignature` property. Without this,
     * requests with function calls will fail with 400 errors.
     *
     * @see https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/core/geminiChat.ts
     * @see https://github.com/sst/opencode/issues/4832
     */
    const injectThoughtSignatures = (request: any): any => {
      if (!request?.contents || !Array.isArray(request.contents)) {
        return request;
      }

      // Find the start of the active loop (last user turn with text)
      let activeLoopStartIndex = -1;
      for (let i = request.contents.length - 1; i >= 0; i--) {
        const content = request.contents[i];
        if (
          content.role === 'user' &&
          content.parts?.some((p: any) => p.text)
        ) {
          activeLoopStartIndex = i;
          break;
        }
      }

      if (activeLoopStartIndex === -1) {
        return request;
      }

      // Inject thoughtSignature into the first functionCall in each model turn
      const newContents = [...request.contents];
      let modified = false;
      for (let i = activeLoopStartIndex; i < newContents.length; i++) {
        const content = newContents[i];
        if (content.role === 'model' && content.parts) {
          const newParts = [...content.parts];
          for (let j = 0; j < newParts.length; j++) {
            const part = newParts[j];
            if (part.functionCall && !part.thoughtSignature) {
              newParts[j] = {
                ...part,
                thoughtSignature: SYNTHETIC_THOUGHT_SIGNATURE,
              };
              newContents[i] = { ...content, parts: newParts };
              modified = true;
              break; // Only the first functionCall in each turn
            }
          }
        }
      }

      if (modified) {
        log.debug(() => ({
          message: 'injected thoughtSignature into function call parts',
        }));
      }

      return { ...request, contents: newContents };
    };

    /**
     * Transform request body for Cloud Code API
     *
     * The Cloud Code API expects requests in this format:
     * {
     *   model: "gemini-2.0-flash",
     *   project: "optional-project-id",
     *   request: { contents: [...], generationConfig: {...}, ... }
     * }
     */
    const transformRequestBody = (
      body: string,
      model: string,
      projectId?: string
    ): string => {
      try {
        let parsed = JSON.parse(body);

        // Inject thoughtSignature for function calls
        parsed = injectThoughtSignatures(parsed);

        // Wrap in Cloud Code API format
        const cloudCodeRequest: Record<string, unknown> = {
          model,
          request: parsed,
        };

        if (projectId) {
          cloudCodeRequest.project = projectId;
        }

        log.debug(() => ({
          message: 'transformed request body for cloud code api',
          model,
          hasProjectId: !!projectId,
          originalBodyLength: body.length,
          transformedBodyLength: JSON.stringify(cloudCodeRequest).length,
        }));

        return JSON.stringify(cloudCodeRequest);
      } catch (error) {
        log.debug(() => ({
          message: 'failed to transform request body, using original',
          error: String(error),
        }));
        return body;
      }
    };

    /**
     * Transform Cloud Code API response to standard format
     *
     * Cloud Code API returns:
     * { response: { candidates: [...], ... }, traceId: "..." }
     *
     * Standard API returns:
     * { candidates: [...], ... }
     */
    const transformResponseBody = async (
      response: Response
    ): Promise<Response> => {
      const contentType = response.headers.get('content-type');
      const isStreaming = contentType?.includes('text/event-stream');

      log.debug(() => ({
        message: 'transforming cloud code response',
        status: response.status,
        contentType,
        isStreaming,
      }));

      if (isStreaming) {
        const reader = response.body?.getReader();
        if (!reader) {
          log.debug(() => ({
            message: 'no response body reader available for streaming',
          }));
          return response;
        }

        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        let chunkCount = 0;

        const transformedStream = new ReadableStream({
          async start(controller) {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) {
                  log.debug(() => ({
                    message: 'streaming response complete',
                    totalChunks: chunkCount,
                  }));
                  controller.close();
                  break;
                }

                const text = decoder.decode(value, { stream: true });
                chunkCount++;

                const events = text.split('\n\n');
                for (const event of events) {
                  if (!event.trim()) continue;

                  if (event.startsWith('data: ')) {
                    try {
                      const jsonStr = event.slice(6).trim();
                      if (jsonStr === '[DONE]') {
                        controller.enqueue(encoder.encode(event + '\n\n'));
                        continue;
                      }

                      const parsed = JSON.parse(jsonStr);
                      const unwrapped = parsed.response || parsed;
                      controller.enqueue(
                        encoder.encode(
                          'data: ' + JSON.stringify(unwrapped) + '\n\n'
                        )
                      );
                    } catch {
                      controller.enqueue(encoder.encode(event + '\n\n'));
                    }
                  } else {
                    controller.enqueue(encoder.encode(event + '\n\n'));
                  }
                }
              }
            } catch (error) {
              log.debug(() => ({
                message: 'error during streaming response transformation',
                error: String(error),
              }));
              controller.error(error);
            }
          },
        });

        return new Response(transformedStream, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }

      // For non-streaming responses, parse and unwrap
      try {
        const json = await response.json();
        const unwrapped = json.response || json;

        log.debug(() => ({
          message: 'unwrapped non-streaming cloud code response',
          hasResponseWrapper: !!json.response,
          hasTraceId: !!json.traceId,
        }));

        return new Response(JSON.stringify(unwrapped), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      } catch (error) {
        log.debug(() => ({
          message: 'failed to parse non-streaming response, returning original',
          error: String(error),
        }));
        return response;
      }
    };

    return {
      apiKey: 'oauth-token-used-via-custom-fetch',
      async fetch(input: RequestInfo | URL, init?: RequestInit) {
        let currentAuth = await getAuth();
        if (!currentAuth || currentAuth.type !== 'oauth') {
          log.debug(() => ({
            message: 'no google oauth credentials, using standard fetch',
          }));
          return fetch(input, init);
        }

        log.debug(() => ({
          message: 'google oauth fetch initiated',
          hasAccessToken: !!currentAuth?.access,
          tokenExpiresIn: currentAuth
            ? Math.round((currentAuth.expires - Date.now()) / 1000)
            : 0,
        }));

        // Refresh token if expired (with 5 minute buffer)
        const FIVE_MIN_MS = 5 * 60 * 1000;
        if (
          !currentAuth.access ||
          currentAuth.expires < Date.now() + FIVE_MIN_MS
        ) {
          log.info(() => ({
            message: 'refreshing google oauth token',
            reason: !currentAuth.access
              ? 'no access token'
              : 'token expiring soon',
          }));

          // Invalidate project cache when token changes
          cachedProjectContext = null;

          const response = await verboseFetch(GOOGLE_TOKEN_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              client_id: GOOGLE_OAUTH_CLIENT_ID,
              client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
              refresh_token: currentAuth.refresh,
              grant_type: 'refresh_token',
            }),
          });

          if (!response.ok) {
            const errorText = await response.text().catch(() => 'unknown');
            log.error(() => ({
              message: 'google oauth token refresh failed',
              status: response.status,
              error: errorText.substring(0, 200),
            }));
            throw new Error(`Token refresh failed: ${response.status}`);
          }

          const json = await response.json();
          log.debug(() => ({
            message: 'google oauth token refreshed successfully',
            expiresIn: json.expires_in,
          }));

          await Auth.set('google', {
            type: 'oauth',
            // Google doesn't return a new refresh token on refresh
            refresh: currentAuth.refresh,
            access: json.access_token,
            expires: Date.now() + json.expires_in * 1000,
          });
          currentAuth = {
            type: 'oauth',
            refresh: currentAuth.refresh,
            access: json.access_token,
            expires: Date.now() + json.expires_in * 1000,
          };
        }

        // Get the original URL
        const originalUrl =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : (input as Request).url;

        log.debug(() => ({
          message: 'processing google api request',
          originalUrl: originalUrl.substring(0, 100),
          method: init?.method || 'GET',
        }));

        // Try to transform to Cloud Code API URL
        const cloudCodeUrl = transformToCloudCodeUrl(originalUrl);
        const model = extractModelFromUrl(originalUrl);

        // If this is a Generative Language API request, route through Cloud Code API
        if (cloudCodeUrl && model) {
          // Ensure project context is available (onboard if needed)
          const projectId = await ensureProjectContext(
            currentAuth.access,
            currentAuth.refresh
          );

          log.info(() => ({
            message: 'routing google oauth request through cloud code api',
            originalUrl: originalUrl.substring(0, 100) + '...',
            cloudCodeUrl,
            model,
            projectId: projectId || '(none)',
          }));

          // Transform request body to Cloud Code format
          let body = init?.body;
          if (typeof body === 'string') {
            body = transformRequestBody(body, model, projectId);
          }

          // Build Cloud Code API URL with alt=sse for streaming
          let finalCloudCodeUrl = cloudCodeUrl;
          if (isStreamingRequest(originalUrl)) {
            const separator = finalCloudCodeUrl.includes('?') ? '&' : '?';
            finalCloudCodeUrl = `${finalCloudCodeUrl}${separator}alt=sse`;
          }

          // Make request to Cloud Code API with Bearer token and retry logic
          const headers: Record<string, string> = {
            ...(init?.headers as Record<string, string>),
            Authorization: `Bearer ${currentAuth.access}`,
            'x-goog-api-client': `agent/${process.env['npm_package_version'] || '0.7.0'}`,
          };
          delete headers['x-goog-api-key'];

          log.debug(() => ({
            message: 'sending request to cloud code api',
            url: finalCloudCodeUrl,
            hasBody: !!body,
          }));

          // Retry loop for transient errors
          let lastResponse: Response | null = null;
          for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            if (attempt > 0) {
              const delay = getRetryDelay(lastResponse!, attempt - 1);
              log.info(() => ({
                message: 'retrying cloud code api request',
                attempt,
                delayMs: delay,
                previousStatus: lastResponse?.status,
              }));
              await new Promise((resolve) => setTimeout(resolve, delay));
            }

            const cloudCodeResponse = await verboseFetch(finalCloudCodeUrl, {
              ...init,
              body,
              headers,
            });

            log.debug(() => ({
              message: 'cloud code api response received',
              status: cloudCodeResponse.status,
              statusText: cloudCodeResponse.statusText,
              contentType: cloudCodeResponse.headers.get('content-type'),
              attempt,
            }));

            // Success - transform and return
            if (cloudCodeResponse.ok) {
              log.debug(() => ({
                message:
                  'cloud code api request successful, transforming response',
              }));
              return transformResponseBody(cloudCodeResponse);
            }

            // Retryable error
            if (
              isRetryableStatus(cloudCodeResponse.status) &&
              attempt < MAX_RETRIES
            ) {
              lastResponse = cloudCodeResponse;
              continue;
            }

            // Non-retryable error or max retries reached
            const errorBody = await cloudCodeResponse
              .clone()
              .text()
              .catch(() => 'unknown');
            log.warn(() => ({
              message: 'cloud code api returned error',
              status: cloudCodeResponse.status,
              statusText: cloudCodeResponse.statusText,
              errorBody: errorBody.substring(0, 500),
              attempt,
            }));

            const fallbackApiKey = getFallbackApiKey();
            if (fallbackApiKey) {
              log.warn(() => ({
                message:
                  'cloud code api error, falling back to api key with standard api',
                status: cloudCodeResponse.status,
                fallbackTarget: originalUrl.substring(0, 100),
              }));

              const apiKeyHeaders: Record<string, string> = {
                ...(init?.headers as Record<string, string>),
                'x-goog-api-key': fallbackApiKey,
              };
              delete apiKeyHeaders['Authorization'];

              return fetch(originalUrl, {
                ...init,
                headers: apiKeyHeaders,
              });
            }

            log.error(() => ({
              message: 'cloud code api error and no api key fallback available',
              status: cloudCodeResponse.status,
              hint: 'Set GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY environment variable for fallback',
            }));

            return cloudCodeResponse;
          }

          // Should not reach here, but return last response as safety net
          return lastResponse!;
        }

        // Not a Generative Language API request, use standard OAuth flow
        log.debug(() => ({
          message:
            'not a generative language api request, using standard oauth',
          url: originalUrl.substring(0, 100),
        }));

        const headers: Record<string, string> = {
          ...(init?.headers as Record<string, string>),
          Authorization: `Bearer ${currentAuth.access}`,
        };
        delete headers['x-goog-api-key'];

        const oauthResponse = await verboseFetch(input, {
          ...init,
          headers,
        });

        log.debug(() => ({
          message: 'standard oauth response received',
          status: oauthResponse.status,
        }));

        // Check if OAuth failed due to insufficient scopes
        if (isScopeError(oauthResponse)) {
          const fallbackApiKey = getFallbackApiKey();
          if (fallbackApiKey) {
            log.warn(() => ({
              message:
                'oauth scope error, falling back to api key authentication',
              hint: 'This should not happen with Cloud Code API routing',
              url: originalUrl.substring(0, 100),
            }));

            const apiKeyHeaders: Record<string, string> = {
              ...(init?.headers as Record<string, string>),
              'x-goog-api-key': fallbackApiKey,
            };
            delete apiKeyHeaders['Authorization'];

            return fetch(input, {
              ...init,
              headers: apiKeyHeaders,
            });
          } else {
            log.error(() => ({
              message: 'oauth scope error and no api key fallback available',
              hint: 'Set GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY environment variable',
              url: originalUrl.substring(0, 100),
            }));
          }
        }

        return oauthResponse;
      },
    };
  },
};

/**
 * Qwen OAuth Configuration
 * Used for Qwen Coder subscription authentication via chat.qwen.ai
 *
 * Based on the official Qwen Code CLI (QwenLM/qwen-code)
 * and qwen-auth-opencode reference implementation:
 * https://github.com/QwenLM/Qwen3-Coder
 * https://github.com/lion-lef/qwen-auth-opencode
 */
