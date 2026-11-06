import * as http from 'node:http';
import { Auth } from './index';
import { ProviderLogins } from './provider-logins';
import { AzureLogin } from './azure-login';
import type { AuthPlugin, AuthResult } from './plugin-types';
export type {
  AuthResult,
  AuthPrompt,
  AuthorizeResult,
  AuthMethod,
  AuthPlugin,
} from './plugin-types';
import { log, verboseFetch, generatePKCE } from './plugin-utils';
import { GooglePlugin } from './google-plugin';

/**
 * Auth Plugins Module
 *
 * Provides OAuth and API authentication methods for various providers.
 * Based on OpenCode's plugin system (opencode-anthropic-auth, opencode-copilot-auth).
 */

/**
 * PKCE utilities
 */
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
            const result = await verboseFetch(
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
            const tokenResult = await verboseFetch(
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
            const apiKeyResult = await verboseFetch(
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
          const response = await verboseFetch(
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

        const deviceResponse = await verboseFetch(urls.DEVICE_CODE_URL, {
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
              const response = await verboseFetch(urls.ACCESS_TOKEN_URL, {
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
          const response = await verboseFetch(urls.COPILOT_API_KEY_URL, {
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
            const tokenResult = await verboseFetch(OPENAI_TOKEN_URL, {
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
          const response = await verboseFetch(OPENAI_TOKEN_URL, {
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
const QWEN_OAUTH_CLIENT_ID = 'f0304373b74a44d2b584a3fb70ca9e56';
const QWEN_OAUTH_SCOPE = 'openid profile email model.completion';
const QWEN_OAUTH_DEVICE_CODE_ENDPOINT =
  'https://chat.qwen.ai/api/v1/oauth2/device/code';
const QWEN_OAUTH_TOKEN_ENDPOINT = 'https://chat.qwen.ai/api/v1/oauth2/token';
const QWEN_OAUTH_DEFAULT_API_URL = 'https://portal.qwen.ai/v1';

/**
 * Detect if running in a headless environment (no GUI)
 */
function isHeadlessEnvironment(): boolean {
  // Check common headless indicators
  if (!process.stdout.isTTY) return true;
  if (process.env.SSH_CLIENT || process.env.SSH_TTY) return true;
  if (process.env.CI) return true;
  if (!process.env.DISPLAY && process.platform === 'linux') return true;
  return false;
}

/**
 * Open URL in the default browser
 */
function openBrowser(url: string): void {
  const platform = process.platform;
  let command: string;

  if (platform === 'darwin') {
    command = 'open';
  } else if (platform === 'win32') {
    command = 'start';
  } else {
    command = 'xdg-open';
  }

  Bun.spawn([command, url], { stdout: 'ignore', stderr: 'ignore' });
}

/**
 * Qwen OAuth Plugin
 * Supports Qwen Coder subscription via OAuth device flow.
 *
 * Uses OAuth 2.0 Device Authorization Grant (RFC 8628) with PKCE (RFC 7636),
 * matching the official Qwen Code CLI implementation.
 *
 * @see https://github.com/QwenLM/Qwen3-Coder
 */
const QwenPlugin: AuthPlugin = {
  provider: 'qwen-coder',
  methods: [
    {
      label: 'Qwen Coder Subscription (OAuth)',
      type: 'oauth',
      async authorize() {
        // Generate PKCE pair
        const codeVerifier = generateRandomString(32);
        const codeChallenge = generateCodeChallenge(codeVerifier);

        // Request device code
        const deviceResponse = await verboseFetch(
          QWEN_OAUTH_DEVICE_CODE_ENDPOINT,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'application/json',
            },
            body: new URLSearchParams({
              client_id: QWEN_OAUTH_CLIENT_ID,
              scope: QWEN_OAUTH_SCOPE,
              code_challenge: codeChallenge,
              code_challenge_method: 'S256',
            }).toString(),
          }
        );

        if (!deviceResponse.ok) {
          const errorText = await deviceResponse.text();
          log.error(() => ({
            message: 'qwen oauth device code request failed',
            status: deviceResponse.status,
            error: errorText,
          }));
          throw new Error(
            `Device authorization failed: ${deviceResponse.status}`
          );
        }

        const deviceData = (await deviceResponse.json()) as {
          device_code: string;
          user_code: string;
          verification_uri: string;
          verification_uri_complete: string;
          expires_in: number;
          interval?: number;
        };

        const pollInterval = (deviceData.interval || 2) * 1000;
        const maxPollAttempts = Math.ceil(
          deviceData.expires_in / (pollInterval / 1000)
        );

        // Try to open browser in non-headless environments
        if (!isHeadlessEnvironment()) {
          try {
            openBrowser(deviceData.verification_uri_complete);
          } catch {
            // Ignore browser open errors
          }
        }

        const instructions = isHeadlessEnvironment()
          ? `Visit: ${deviceData.verification_uri}\nEnter code: ${deviceData.user_code}`
          : `Opening browser for authentication...\nIf browser doesn't open, visit: ${deviceData.verification_uri}\nEnter code: ${deviceData.user_code}`;

        return {
          url: deviceData.verification_uri_complete,
          instructions,
          method: 'auto' as const,
          async callback(): Promise<AuthResult> {
            // Poll for authorization completion
            for (let attempt = 0; attempt < maxPollAttempts; attempt++) {
              const tokenResponse = await verboseFetch(
                QWEN_OAUTH_TOKEN_ENDPOINT,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Accept: 'application/json',
                  },
                  body: new URLSearchParams({
                    client_id: QWEN_OAUTH_CLIENT_ID,
                    device_code: deviceData.device_code,
                    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
                    code_verifier: codeVerifier,
                  }).toString(),
                }
              );

              if (!tokenResponse.ok) {
                const errorText = await tokenResponse.text();
                try {
                  const errorJson = JSON.parse(errorText);
                  if (
                    errorJson.error === 'authorization_pending' ||
                    errorJson.error === 'slow_down'
                  ) {
                    await new Promise((resolve) =>
                      setTimeout(
                        resolve,
                        errorJson.error === 'slow_down'
                          ? pollInterval * 1.5
                          : pollInterval
                      )
                    );
                    continue;
                  }
                } catch {
                  // JSON parse failed, treat as regular error
                }

                log.error(() => ({
                  message: 'qwen oauth token poll failed',
                  status: tokenResponse.status,
                  error: errorText,
                }));
                return { type: 'failed' };
              }

              const tokenData = (await tokenResponse.json()) as {
                access_token: string;
                refresh_token?: string;
                token_type: string;
                expires_in: number;
                resource_url?: string;
              };

              return {
                type: 'success',
                refresh: tokenData.refresh_token || '',
                access: tokenData.access_token,
                expires: Date.now() + tokenData.expires_in * 1000,
              };
            }

            log.error(() => ({
              message: 'qwen oauth authorization timeout',
            }));
            return { type: 'failed' };
          },
        };
      },
    },
  ],
  async loader(getAuth, provider) {
    const auth = await getAuth();
    if (!auth || auth.type !== 'oauth') return {};

    // Zero out cost for subscription users (free tier)
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
      baseURL: QWEN_OAUTH_DEFAULT_API_URL,
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
          if (!currentAuth.refresh) {
            log.error(() => ({
              message:
                'qwen oauth token expired and no refresh token available',
            }));
            throw new Error(
              'Qwen OAuth token expired. Please re-authenticate with: agent auth login'
            );
          }

          log.info(() => ({
            message: 'refreshing qwen oauth token',
            reason: !currentAuth.access
              ? 'no access token'
              : 'token expiring soon',
          }));

          const response = await verboseFetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'application/json',
            },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: currentAuth.refresh,
              client_id: QWEN_OAUTH_CLIENT_ID,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text().catch(() => 'unknown');
            log.error(() => ({
              message: 'qwen oauth token refresh failed',
              status: response.status,
              error: errorText.substring(0, 200),
            }));
            throw new Error(
              `Qwen token refresh failed: ${response.status}. Please re-authenticate with: agent auth login`
            );
          }

          const json = await response.json();
          log.info(() => ({
            message: 'qwen oauth token refreshed successfully',
            expiresIn: json.expires_in,
          }));

          await Auth.set('qwen-coder', {
            type: 'oauth',
            refresh: json.refresh_token || currentAuth.refresh,
            access: json.access_token,
            expires: Date.now() + json.expires_in * 1000,
          });
          currentAuth = {
            type: 'oauth',
            refresh: json.refresh_token || currentAuth.refresh,
            access: json.access_token,
            expires: Date.now() + json.expires_in * 1000,
          };
        }

        const headers: Record<string, string> = {
          ...(init?.headers as Record<string, string>),
          Authorization: `Bearer ${currentAuth.access}`,
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
 * Alibaba Plugin (alias for Qwen Coder)
 * This provides a separate menu entry for Alibaba
 * with the same Qwen Coder subscription authentication.
 */
const AlibabaPlugin: AuthPlugin = {
  provider: 'alibaba',
  methods: [
    {
      label: 'Qwen Coder Subscription (OAuth)',
      type: 'oauth',
      async authorize() {
        // Delegate to QwenPlugin's OAuth method
        const qwenMethod = QwenPlugin.methods[0];
        if (qwenMethod?.authorize) {
          const result = await qwenMethod.authorize({});
          // Override the callback to save as alibaba provider
          if ('callback' in result) {
            const originalCallback = result.callback;
            return {
              ...result,
              async callback(code?: string): Promise<AuthResult> {
                const authResult = await originalCallback(code);
                if (authResult.type === 'success' && 'refresh' in authResult) {
                  return {
                    ...authResult,
                    provider: 'alibaba',
                  };
                }
                return authResult;
              },
            };
          }
        }
        return {
          method: 'auto' as const,
          async callback(): Promise<AuthResult> {
            return { type: 'failed' };
          },
        };
      },
    },
  ],
  async loader(getAuth, provider) {
    const auth = await getAuth();
    if (!auth || auth.type !== 'oauth') return {};

    // Zero out cost for subscription users (free tier)
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
      baseURL: QWEN_OAUTH_DEFAULT_API_URL,
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
          if (!currentAuth.refresh) {
            log.error(() => ({
              message:
                'qwen oauth token expired and no refresh token available (alibaba)',
            }));
            throw new Error(
              'Qwen OAuth token expired. Please re-authenticate with: agent auth login'
            );
          }

          log.info(() => ({
            message: 'refreshing qwen oauth token (alibaba provider)',
          }));

          const response = await verboseFetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'application/json',
            },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: currentAuth.refresh,
              client_id: QWEN_OAUTH_CLIENT_ID,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text().catch(() => 'unknown');
            log.error(() => ({
              message: 'qwen oauth token refresh failed (alibaba)',
              status: response.status,
              error: errorText.substring(0, 200),
            }));
            throw new Error(
              `Qwen token refresh failed: ${response.status}. Please re-authenticate with: agent auth login`
            );
          }

          const json = await response.json();
          await Auth.set('alibaba', {
            type: 'oauth',
            refresh: json.refresh_token || currentAuth.refresh,
            access: json.access_token,
            expires: Date.now() + json.expires_in * 1000,
          });
          currentAuth = {
            type: 'oauth',
            refresh: json.refresh_token || currentAuth.refresh,
            access: json.access_token,
            expires: Date.now() + json.expires_in * 1000,
          };
        }

        const headers: Record<string, string> = {
          ...(init?.headers as Record<string, string>),
          Authorization: `Bearer ${currentAuth.access}`,
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
 * Kilo Gateway constants
 * @see https://github.com/Kilo-Org/kilo/blob/main/packages/kilo-gateway/src/api/constants.ts
 */
const KILO_API_BASE = 'https://api.kilo.ai';
const KILO_POLL_INTERVAL_MS = 3000;

/**
 * Kilo Gateway Auth Plugin
 * Supports device authorization flow for Kilo Gateway
 *
 * @see https://github.com/Kilo-Org/kilo/blob/main/packages/kilo-gateway/src/auth/device-auth.ts
 */
const KiloPlugin: AuthPlugin = {
  provider: 'kilo',
  methods: [
    {
      label: 'Kilo Gateway (Device Authorization)',
      type: 'oauth',
      async authorize() {
        // Initiate device authorization
        const initResponse = await verboseFetch(
          `${KILO_API_BASE}/api/device-auth/codes`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          }
        );

        if (!initResponse.ok) {
          if (initResponse.status === 429) {
            log.error(() => ({
              message:
                'kilo device auth rate limited - too many pending requests',
            }));
            return {
              method: 'auto' as const,
              async callback(): Promise<AuthResult> {
                return { type: 'failed' };
              },
            };
          }
          log.error(() => ({
            message: 'kilo device auth initiation failed',
            status: initResponse.status,
          }));
          return {
            method: 'auto' as const,
            async callback(): Promise<AuthResult> {
              return { type: 'failed' };
            },
          };
        }

        const authData = (await initResponse.json()) as {
          code: string;
          verificationUrl: string;
          expiresIn: number;
        };

        return {
          url: authData.verificationUrl,
          instructions: `Enter code: ${authData.code}\nWaiting for authorization...`,
          method: 'auto' as const,
          async callback(): Promise<AuthResult> {
            const maxAttempts = Math.ceil(
              (authData.expiresIn * 1000) / KILO_POLL_INTERVAL_MS
            );

            for (let attempt = 0; attempt < maxAttempts; attempt++) {
              await new Promise((resolve) =>
                setTimeout(resolve, KILO_POLL_INTERVAL_MS)
              );

              const pollResponse = await verboseFetch(
                `${KILO_API_BASE}/api/device-auth/codes/${authData.code}`
              );

              if (pollResponse.status === 202) {
                // Still pending
                continue;
              }

              if (pollResponse.status === 403) {
                log.error(() => ({
                  message: 'kilo device auth denied by user',
                }));
                return { type: 'failed' };
              }

              if (pollResponse.status === 410) {
                log.error(() => ({
                  message: 'kilo device auth code expired',
                }));
                return { type: 'failed' };
              }

              if (!pollResponse.ok) {
                log.error(() => ({
                  message: 'kilo device auth poll failed',
                  status: pollResponse.status,
                }));
                return { type: 'failed' };
              }

              const data = (await pollResponse.json()) as {
                status: string;
                token?: string;
                userEmail?: string;
              };

              if (data.status === 'approved' && data.token) {
                log.info(() => ({
                  message: 'kilo device auth approved',
                  email: data.userEmail,
                }));

                // Token from Kilo device auth is long-lived (1 year)
                const TOKEN_EXPIRATION_MS = 365 * 24 * 60 * 60 * 1000;
                return {
                  type: 'success',
                  provider: 'kilo',
                  refresh: data.token,
                  access: data.token,
                  expires: Date.now() + TOKEN_EXPIRATION_MS,
                };
              }
            }

            log.error(() => ({
              message: 'kilo device auth timed out',
            }));
            return { type: 'failed' };
          },
        };
      },
    },
    {
      label: 'API Key',
      type: 'api',
      async authorize(inputs: Record<string, string>) {
        const key = inputs['key'];
        if (!key) return { type: 'failed' };
        return {
          type: 'success',
          provider: 'kilo',
          key,
        };
      },
    },
  ],
  async loader(getAuth) {
    const auth = await getAuth();
    if (!auth) return {};

    if (auth.type === 'api') {
      return { apiKey: auth.key };
    }

    if (auth.type === 'oauth') {
      return { apiKey: auth.access };
    }

    return {};
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
  'qwen-coder': QwenPlugin,
  alibaba: AlibabaPlugin,
  kilo: KiloPlugin,
  xai: ProviderLogins.XAIPlugin,
  poe: ProviderLogins.PoePlugin,
  digitalocean: ProviderLogins.DigitalOceanPlugin,
  gitlab: ProviderLogins.GitLabPlugin,
  azure: AzureLogin.Plugin,
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
