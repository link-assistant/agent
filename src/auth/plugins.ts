import crypto from 'crypto';
import * as http from 'node:http';
import * as net from 'node:net';
import { Auth } from './index';
import { Log } from '../util/log';

/**
 * Auth Plugins Module
 *
 * Provides OAuth and API authentication methods for various providers.
 * Based on OpenCode's plugin system (opencode-anthropic-auth, opencode-copilot-auth).
 */

const log = Log.create({ service: 'auth-plugins' });

/**
 * OAuth callback result types
 */
export type AuthResult =
  | { type: 'failed' }
  | {
      type: 'success';
      provider?: string;
      refresh: string;
      access: string;
      expires: number;
      enterpriseUrl?: string;
    }
  | { type: 'success'; provider?: string; key: string };

/**
 * Auth method prompt configuration
 */
export interface AuthPrompt {
  type: 'text' | 'select';
  key: string;
  message: string;
  placeholder?: string;
  options?: Array<{ label: string; value: string; hint?: string }>;
  condition?: (inputs: Record<string, string>) => boolean;
  validate?: (value: string) => string | undefined;
}

/**
 * OAuth authorization result
 */
export interface AuthorizeResult {
  url?: string;
  instructions?: string;
  method: 'code' | 'auto';
  callback: (code?: string) => Promise<AuthResult>;
}

/**
 * Auth method definition
 */
export interface AuthMethod {
  label: string;
  type: 'oauth' | 'api';
  prompts?: AuthPrompt[];
  authorize?: (
    inputs: Record<string, string>
  ) => Promise<AuthorizeResult | AuthResult>;
}

/**
 * Auth plugin definition
 */
export interface AuthPlugin {
  provider: string;
  methods: AuthMethod[];
  loader?: (
    getAuth: () => Promise<Auth.Info | undefined>,
    provider: any
  ) => Promise<{
    apiKey?: string;
    baseURL?: string;
    fetch?: typeof fetch;
  }>;
}

/**
 * PKCE utilities
 */
function generateRandomString(length: number): string {
  return crypto.randomBytes(length).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

async function generatePKCE() {
  const verifier = generateRandomString(32);
  const challenge = generateCodeChallenge(verifier);
  return { verifier, challenge };
}

/**
 * Anthropic OAuth Configuration
 * Used for Claude Pro/Max subscription authentication
 */
const ANTHROPIC_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

/**
 * Anthropic OAuth Plugin
 * Supports:
 * - Claude Pro/Max OAuth login
 * - API key creation via OAuth
 * - Manual API key entry
 */
const AnthropicPlugin: AuthPlugin = {
  provider: 'anthropic',
  methods: [
    {
      label: 'Claude Pro/Max',
      type: 'oauth',
      async authorize() {
        const pkce = await generatePKCE();

        const url = new URL('https://claude.ai/oauth/authorize');
        url.searchParams.set('code', 'true');
        url.searchParams.set('client_id', ANTHROPIC_CLIENT_ID);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set(
          'redirect_uri',
          'https://console.anthropic.com/oauth/code/callback'
        );
        url.searchParams.set(
          'scope',
          'org:create_api_key user:profile user:inference'
        );
        url.searchParams.set('code_challenge', pkce.challenge);
        url.searchParams.set('code_challenge_method', 'S256');
        url.searchParams.set('state', pkce.verifier);

        return {
          url: url.toString(),
          instructions: 'Paste the authorization code here: ',
          method: 'code' as const,
          async callback(code?: string): Promise<AuthResult> {
            if (!code) return { type: 'failed' };

            const splits = code.split('#');
            const result = await fetch(
              'https://console.anthropic.com/v1/oauth/token',
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  code: splits[0],
                  state: splits[1],
                  grant_type: 'authorization_code',
                  client_id: ANTHROPIC_CLIENT_ID,
                  redirect_uri:
                    'https://console.anthropic.com/oauth/code/callback',
                  code_verifier: pkce.verifier,
                }),
              }
            );

            if (!result.ok) {
              log.error(() => ({
                message: 'anthropic oauth token exchange failed',
                status: result.status,
              }));
              return { type: 'failed' };
            }

            const json = await result.json();
            return {
              type: 'success',
              refresh: json.refresh_token,
              access: json.access_token,
              expires: Date.now() + json.expires_in * 1000,
            };
          },
        };
      },
    },
    {
      label: 'Create an API Key',
      type: 'oauth',
      async authorize() {
        const pkce = await generatePKCE();

        const url = new URL('https://console.anthropic.com/oauth/authorize');
        url.searchParams.set('code', 'true');
        url.searchParams.set('client_id', ANTHROPIC_CLIENT_ID);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set(
          'redirect_uri',
          'https://console.anthropic.com/oauth/code/callback'
        );
        url.searchParams.set(
          'scope',
          'org:create_api_key user:profile user:inference'
        );
        url.searchParams.set('code_challenge', pkce.challenge);
        url.searchParams.set('code_challenge_method', 'S256');
        url.searchParams.set('state', pkce.verifier);

        return {
          url: url.toString(),
          instructions: 'Paste the authorization code here: ',
          method: 'code' as const,
          async callback(code?: string): Promise<AuthResult> {
            if (!code) return { type: 'failed' };

            const splits = code.split('#');
            const tokenResult = await fetch(
              'https://console.anthropic.com/v1/oauth/token',
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  code: splits[0],
                  state: splits[1],
                  grant_type: 'authorization_code',
                  client_id: ANTHROPIC_CLIENT_ID,
                  redirect_uri:
                    'https://console.anthropic.com/oauth/code/callback',
                  code_verifier: pkce.verifier,
                }),
              }
            );

            if (!tokenResult.ok) {
              log.error(() => ({
                message: 'anthropic oauth token exchange failed',
                status: tokenResult.status,
              }));
              return { type: 'failed' };
            }

            const credentials = await tokenResult.json();

            // Create API key using the access token
            const apiKeyResult = await fetch(
              'https://api.anthropic.com/api/oauth/claude_cli/create_api_key',
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${credentials.access_token}`,
                },
              }
            ).then((r) => r.json());

            return { type: 'success', key: apiKeyResult.raw_key };
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

    // Zero out cost for max plan users
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

    return {
      apiKey: 'oauth-token-used-via-custom-fetch',
      async fetch(input: RequestInfo | URL, init?: RequestInit) {
        let currentAuth = await getAuth();
        if (!currentAuth || currentAuth.type !== 'oauth')
          return fetch(input, init);

        // Refresh token if expired
        if (!currentAuth.access || currentAuth.expires < Date.now()) {
          log.info(() => ({
            message: 'refreshing anthropic oauth token',
          }));
          const response = await fetch(
            'https://console.anthropic.com/v1/oauth/token',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                grant_type: 'refresh_token',
                refresh_token: currentAuth.refresh,
                client_id: ANTHROPIC_CLIENT_ID,
              }),
            }
          );

          if (!response.ok) {
            throw new Error(`Token refresh failed: ${response.status}`);
          }

          const json = await response.json();
          await Auth.set('anthropic', {
            type: 'oauth',
            refresh: json.refresh_token,
            access: json.access_token,
            expires: Date.now() + json.expires_in * 1000,
          });
          currentAuth = {
            type: 'oauth',
            refresh: json.refresh_token,
            access: json.access_token,
            expires: Date.now() + json.expires_in * 1000,
          };
        }

        // Add oauth beta and other required betas
        const incomingBeta =
          (init?.headers as Record<string, string>)?.['anthropic-beta'] || '';
        const incomingBetasList = incomingBeta
          .split(',')
          .map((b) => b.trim())
          .filter(Boolean);

        const mergedBetas = [
          ...new Set([
            'oauth-2025-04-20',
            'claude-code-20250219',
            'interleaved-thinking-2025-05-14',
            'fine-grained-tool-streaming-2025-05-14',
            ...incomingBetasList,
          ]),
        ].join(',');

        const headers: Record<string, string> = {
          ...(init?.headers as Record<string, string>),
          authorization: `Bearer ${currentAuth.access}`,
          'anthropic-beta': mergedBetas,
        };
        delete headers['x-api-key'];

        return fetch(input, {
          ...init,
          headers,
        });
      },
    };
  },
};

/**
 * GitHub Copilot OAuth Configuration
 */
const COPILOT_CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const COPILOT_HEADERS = {
  'User-Agent': 'GitHubCopilotChat/0.32.4',
  'Editor-Version': 'vscode/1.105.1',
  'Editor-Plugin-Version': 'copilot-chat/0.32.4',
  'Copilot-Integration-Id': 'vscode-chat',
};

function normalizeDomain(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function getCopilotUrls(domain: string) {
  return {
    DEVICE_CODE_URL: `https://${domain}/login/device/code`,
    ACCESS_TOKEN_URL: `https://${domain}/login/oauth/access_token`,
    COPILOT_API_KEY_URL: `https://api.${domain}/copilot_internal/v2/token`,
  };
}

/**
 * GitHub Copilot OAuth Plugin
 * Supports:
 * - GitHub.com Copilot
 * - GitHub Enterprise Copilot
 */
const GitHubCopilotPlugin: AuthPlugin = {
  provider: 'github-copilot',
  methods: [
    {
      type: 'oauth',
      label: 'Login with GitHub Copilot',
      prompts: [
        {
          type: 'select',
          key: 'deploymentType',
          message: 'Select GitHub deployment type',
          options: [
            {
              label: 'GitHub.com',
              value: 'github.com',
              hint: 'Public',
            },
            {
              label: 'GitHub Enterprise',
              value: 'enterprise',
              hint: 'Data residency or self-hosted',
            },
          ],
        },
        {
          type: 'text',
          key: 'enterpriseUrl',
          message: 'Enter your GitHub Enterprise URL or domain',
          placeholder: 'company.ghe.com or https://company.ghe.com',
          condition: (inputs) => inputs.deploymentType === 'enterprise',
          validate: (value) => {
            if (!value) return 'URL or domain is required';
            try {
              const url = value.includes('://')
                ? new URL(value)
                : new URL(`https://${value}`);
              if (!url.hostname) return 'Please enter a valid URL or domain';
              return undefined;
            } catch {
              return 'Please enter a valid URL (e.g., company.ghe.com or https://company.ghe.com)';
            }
          },
        },
      ],
      async authorize(inputs = {}): Promise<AuthorizeResult> {
        const deploymentType = inputs.deploymentType || 'github.com';

        let domain = 'github.com';
        let actualProvider = 'github-copilot';

        if (deploymentType === 'enterprise') {
          const enterpriseUrl = inputs.enterpriseUrl;
          domain = normalizeDomain(enterpriseUrl);
          actualProvider = 'github-copilot-enterprise';
        }

        const urls = getCopilotUrls(domain);

        const deviceResponse = await fetch(urls.DEVICE_CODE_URL, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'GitHubCopilotChat/0.35.0',
          },
          body: JSON.stringify({
            client_id: COPILOT_CLIENT_ID,
            scope: 'read:user',
          }),
        });

        if (!deviceResponse.ok) {
          throw new Error('Failed to initiate device authorization');
        }

        const deviceData = (await deviceResponse.json()) as {
          verification_uri: string;
          user_code: string;
          device_code: string;
          interval: number;
        };

        return {
          url: deviceData.verification_uri,
          instructions: `Enter code: ${deviceData.user_code}`,
          method: 'auto',
          async callback(): Promise<AuthResult> {
            while (true) {
              const response = await fetch(urls.ACCESS_TOKEN_URL, {
                method: 'POST',
                headers: {
                  Accept: 'application/json',
                  'Content-Type': 'application/json',
                  'User-Agent': 'GitHubCopilotChat/0.35.0',
                },
                body: JSON.stringify({
                  client_id: COPILOT_CLIENT_ID,
                  device_code: deviceData.device_code,
                  grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
                }),
              });

              if (!response.ok) return { type: 'failed' };

              const data = (await response.json()) as {
                access_token?: string;
                error?: string;
              };

              if (data.access_token) {
                const result: AuthResult = {
                  type: 'success',
                  refresh: data.access_token,
                  access: '',
                  expires: 0,
                };

                if (actualProvider === 'github-copilot-enterprise') {
                  (result as any).provider = 'github-copilot-enterprise';
                  (result as any).enterpriseUrl = domain;
                }

                return result;
              }

              if (data.error === 'authorization_pending') {
                await new Promise((resolve) =>
                  setTimeout(resolve, deviceData.interval * 1000)
                );
                continue;
              }

              if (data.error) return { type: 'failed' };

              await new Promise((resolve) =>
                setTimeout(resolve, deviceData.interval * 1000)
              );
            }
          },
        };
      },
    },
  ],
  async loader(getAuth, provider) {
    const info = await getAuth();
    if (!info || info.type !== 'oauth') return {};

    // Zero out cost for copilot users
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

    // Set baseURL based on deployment type
    const enterpriseUrl = (info as any).enterpriseUrl;
    const baseURL = enterpriseUrl
      ? `https://copilot-api.${normalizeDomain(enterpriseUrl)}`
      : 'https://api.githubcopilot.com';

    return {
      baseURL,
      apiKey: 'oauth-token-used-via-custom-fetch',
      async fetch(input: RequestInfo | URL, init?: RequestInit) {
        let currentInfo = await getAuth();
        if (!currentInfo || currentInfo.type !== 'oauth')
          return fetch(input, init);

        // Refresh token if expired
        if (!currentInfo.access || currentInfo.expires < Date.now()) {
          const domain = (currentInfo as any).enterpriseUrl
            ? normalizeDomain((currentInfo as any).enterpriseUrl)
            : 'github.com';
          const urls = getCopilotUrls(domain);

          log.info(() => ({ message: 'refreshing github copilot token' }));
          const response = await fetch(urls.COPILOT_API_KEY_URL, {
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${currentInfo.refresh}`,
              ...COPILOT_HEADERS,
            },
          });

          if (!response.ok) {
            throw new Error(`Token refresh failed: ${response.status}`);
          }

          const tokenData = (await response.json()) as {
            token: string;
            expires_at: number;
          };

          const saveProviderID = (currentInfo as any).enterpriseUrl
            ? 'github-copilot-enterprise'
            : 'github-copilot';
          await Auth.set(saveProviderID, {
            type: 'oauth',
            refresh: currentInfo.refresh,
            access: tokenData.token,
            expires: tokenData.expires_at * 1000,
            ...((currentInfo as any).enterpriseUrl && {
              enterpriseUrl: (currentInfo as any).enterpriseUrl,
            }),
          } as Auth.Info);

          currentInfo = {
            type: 'oauth',
            refresh: currentInfo.refresh,
            access: tokenData.token,
            expires: tokenData.expires_at * 1000,
          };
        }

        // Detect agent calls and vision requests
        let isAgentCall = false;
        let isVisionRequest = false;
        try {
          const body =
            typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
          if (body?.messages) {
            isAgentCall = body.messages.some(
              (msg: any) => msg.role && ['tool', 'assistant'].includes(msg.role)
            );
            isVisionRequest = body.messages.some(
              (msg: any) =>
                Array.isArray(msg.content) &&
                msg.content.some((part: any) => part.type === 'image_url')
            );
          }
        } catch {}

        const headers: Record<string, string> = {
          ...(init?.headers as Record<string, string>),
          ...COPILOT_HEADERS,
          Authorization: `Bearer ${currentInfo.access}`,
          'Openai-Intent': 'conversation-edits',
          'X-Initiator': isAgentCall ? 'agent' : 'user',
        };

        if (isVisionRequest) {
          headers['Copilot-Vision-Request'] = 'true';
        }

        delete headers['x-api-key'];
        delete headers['authorization'];

        return fetch(input, {
          ...init,
          headers,
        });
      },
    };
  },
};

/**
 * OpenAI ChatGPT OAuth Configuration
 * Used for ChatGPT Plus/Pro subscription authentication via Codex backend
 */
const OPENAI_CLIENT_ID = 'app_EMoamEEEZ73f0CkXaXp7hrann';
const OPENAI_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const OPENAI_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const OPENAI_REDIRECT_URI = 'http://localhost:1455/auth/callback';
const OPENAI_SCOPE = 'openid profile email offline_access';

/**
 * OpenAI ChatGPT OAuth Plugin
 * Supports:
 * - ChatGPT Plus/Pro OAuth login
 * - Manual API key entry
 *
 * Note: This is a simplified implementation that uses manual code entry.
 * The full opencode-openai-codex-auth plugin uses a local server on port 1455.
 */
const OpenAIPlugin: AuthPlugin = {
  provider: 'openai',
  methods: [
    {
      label: 'ChatGPT Plus/Pro (OAuth)',
      type: 'oauth',
      async authorize() {
        const pkce = await generatePKCE();
        const state = generateRandomString(16);

        const url = new URL(OPENAI_AUTHORIZE_URL);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('client_id', OPENAI_CLIENT_ID);
        url.searchParams.set('redirect_uri', OPENAI_REDIRECT_URI);
        url.searchParams.set('scope', OPENAI_SCOPE);
        url.searchParams.set('code_challenge', pkce.challenge);
        url.searchParams.set('code_challenge_method', 'S256');
        url.searchParams.set('state', state);
        url.searchParams.set('id_token_add_organizations', 'true');
        url.searchParams.set('codex_cli_simplified_flow', 'true');
        url.searchParams.set('originator', 'codex_cli_rs');

        return {
          url: url.toString(),
          instructions:
            'After authorizing, copy the URL from your browser address bar and paste it here (or just the code parameter): ',
          method: 'code' as const,
          async callback(input?: string): Promise<AuthResult> {
            if (!input) return { type: 'failed' };

            // Parse authorization input - can be full URL, code#state, or just code
            let code: string | undefined;
            let receivedState: string | undefined;

            try {
              const inputUrl = new URL(input.trim());
              code = inputUrl.searchParams.get('code') ?? undefined;
              receivedState = inputUrl.searchParams.get('state') ?? undefined;
            } catch {
              // Not a URL, try other formats
              if (input.includes('#')) {
                const [c, s] = input.split('#', 2);
                code = c;
                receivedState = s;
              } else if (input.includes('code=')) {
                const params = new URLSearchParams(input);
                code = params.get('code') ?? undefined;
                receivedState = params.get('state') ?? undefined;
              } else {
                code = input.trim();
              }
            }

            if (!code) {
              log.error(() => ({
                message: 'openai oauth no code provided',
              }));
              return { type: 'failed' };
            }

            // Exchange authorization code for tokens
            const tokenResult = await fetch(OPENAI_TOKEN_URL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: OPENAI_CLIENT_ID,
                code,
                code_verifier: pkce.verifier,
                redirect_uri: OPENAI_REDIRECT_URI,
              }),
            });

            if (!tokenResult.ok) {
              log.error(() => ({
                message: 'openai oauth token exchange failed',
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
                message: 'openai oauth token response missing fields',
              }));
              return { type: 'failed' };
            }

            return {
              type: 'success',
              refresh: json.refresh_token,
              access: json.access_token,
              expires: Date.now() + json.expires_in * 1000,
            };
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

    // Note: Full OpenAI Codex support would require additional request transformations
    // For now, this provides basic OAuth token management
    return {
      apiKey: 'oauth-token-used-via-custom-fetch',
      baseURL: 'https://chatgpt.com/backend-api',
      async fetch(input: RequestInfo | URL, init?: RequestInit) {
        let currentAuth = await getAuth();
        if (!currentAuth || currentAuth.type !== 'oauth')
          return fetch(input, init);

        // Refresh token if expired
        if (!currentAuth.access || currentAuth.expires < Date.now()) {
          log.info(() => ({ message: 'refreshing openai oauth token' }));
          const response = await fetch(OPENAI_TOKEN_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: currentAuth.refresh,
              client_id: OPENAI_CLIENT_ID,
            }),
          });

          if (!response.ok) {
            throw new Error(`Token refresh failed: ${response.status}`);
          }

          const json = await response.json();
          await Auth.set('openai', {
            type: 'oauth',
            refresh: json.refresh_token,
            access: json.access_token,
            expires: Date.now() + json.expires_in * 1000,
          });
          currentAuth = {
            type: 'oauth',
            refresh: json.refresh_token,
            access: json.access_token,
            expires: Date.now() + json.expires_in * 1000,
          };
        }

        const headers: Record<string, string> = {
          ...(init?.headers as Record<string, string>),
          authorization: `Bearer ${currentAuth.access}`,
        };
        delete headers['x-api-key'];

        return fetch(input, {
          ...init,
          headers,
        });
      },
    };
  },
};

/**
 * Google OAuth Configuration
 * Used for Google AI Pro/Ultra subscription authentication
 *
 * These credentials are from the official Gemini CLI (google-gemini/gemini-cli)
 * and are public for installed applications as per Google OAuth documentation:
 * https://developers.google.com/identity/protocols/oauth2#installed
 */
const GOOGLE_OAUTH_CLIENT_ID =
  '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';
const GOOGLE_OAUTH_CLIENT_SECRET = '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';
const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/generative-language.tuning',
  'https://www.googleapis.com/auth/generative-language.retriever',
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
const GooglePlugin: AuthPlugin = {
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
              const tokenResult = await fetch(GOOGLE_TOKEN_URL, {
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
              const tokenResult = await fetch(GOOGLE_TOKEN_URL, {
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

    return {
      apiKey: 'oauth-token-used-via-custom-fetch',
      async fetch(input: RequestInfo | URL, init?: RequestInit) {
        let currentAuth = await getAuth();
        if (!currentAuth || currentAuth.type !== 'oauth')
          return fetch(input, init);

        // Refresh token if expired (with 5 minute buffer)
        const FIVE_MIN_MS = 5 * 60 * 1000;
        if (
          !currentAuth.access ||
          currentAuth.expires < Date.now() + FIVE_MIN_MS
        ) {
          log.info(() => ({ message: 'refreshing google oauth token' }));
          const response = await fetch(GOOGLE_TOKEN_URL, {
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
            throw new Error(`Token refresh failed: ${response.status}`);
          }

          const json = await response.json();
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

        // Google API uses Bearer token authentication
        const headers: Record<string, string> = {
          ...(init?.headers as Record<string, string>),
          Authorization: `Bearer ${currentAuth.access}`,
        };
        // Remove any API key header if present since we're using OAuth
        delete headers['x-goog-api-key'];

        return fetch(input, {
          ...init,
          headers,
        });
      },
    };
  },
};

/**
 * Registry of all auth plugins
 */
const plugins: Record<string, AuthPlugin> = {
  anthropic: AnthropicPlugin,
  'github-copilot': GitHubCopilotPlugin,
  openai: OpenAIPlugin,
  google: GooglePlugin,
};

/**
 * Auth Plugins namespace
 */
export namespace AuthPlugins {
  /**
   * Get a plugin by provider ID
   */
  export function getPlugin(providerId: string): AuthPlugin | undefined {
    return plugins[providerId];
  }

  /**
   * Get all plugins
   */
  export function getAllPlugins(): AuthPlugin[] {
    return Object.values(plugins);
  }

  /**
   * Get the loader for a provider
   */
  export async function getLoader(providerId: string) {
    const plugin = plugins[providerId];
    if (!plugin?.loader) return undefined;

    return async (
      getAuth: () => Promise<Auth.Info | undefined>,
      provider: any
    ) => {
      return plugin.loader!(getAuth, provider);
    };
  }
}
