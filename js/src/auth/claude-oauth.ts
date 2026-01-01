import crypto from 'crypto';
import path from 'path';
import { Global } from '../global';
import { Log } from '../util/log';
import z from 'zod';

/**
 * Claude OAuth Module
 *
 * Implements OAuth 2.0 with PKCE for Claude authentication.
 * This allows using Claude Pro/Max subscription for API access.
 *
 * OAuth Flow:
 * 1. Generate PKCE code verifier and challenge
 * 2. Open browser to authorization URL
 * 3. User authenticates and authorizes
 * 4. Receive authorization code via redirect
 * 5. Exchange code for tokens
 * 6. Store tokens in ~/.claude/.credentials.json
 *
 * References:
 * - Claude Code CLI uses the same OAuth flow
 * - https://github.com/grll/claude-code-login for implementation details
 */
export namespace ClaudeOAuth {
  const log = Log.create({ service: 'claude-oauth' });

  /**
   * OAuth Configuration
   * These values are from the Claude Code CLI OAuth implementation
   */
  export const Config = {
    // OAuth endpoints
    authorizationUrl: 'https://claude.ai/oauth/authorize',
    tokenUrl: 'https://console.anthropic.com/v1/oauth/token',
    redirectUri: 'https://console.anthropic.com/oauth/code/callback',

    // OAuth client - this is the same client ID used by Claude Code CLI
    clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',

    // Requested scopes for API access
    scopes: ['org:create_api_key', 'user:profile', 'user:inference'],

    // API beta header for OAuth authentication
    betaHeader: 'oauth-2025-04-20',
  } as const;

  /**
   * Schema for OAuth credentials stored in ~/.claude/.credentials.json
   */
  export const Credentials = z.object({
    claudeAiOauth: z
      .object({
        accessToken: z.string(),
        refreshToken: z.string(),
        expiresAt: z.number(),
        scopes: z.array(z.string()).optional(),
        subscriptionType: z.string().optional(),
        rateLimitTier: z.string().optional(),
      })
      .optional(),
  });

  export type Credentials = z.infer<typeof Credentials>;

  /**
   * Schema for OAuth state file (temporary, during auth flow)
   */
  export const OAuthState = z.object({
    state: z.string(),
    codeVerifier: z.string(),
    expiresAt: z.number(),
  });

  export type OAuthState = z.infer<typeof OAuthState>;

  /**
   * Schema for token response from OAuth server
   */
  export const TokenResponse = z.object({
    access_token: z.string(),
    refresh_token: z.string(),
    expires_in: z.number(),
    token_type: z.string(),
    scope: z.string().optional(),
  });

  export type TokenResponse = z.infer<typeof TokenResponse>;

  /**
   * Paths for credential and state storage
   */
  const claudeDir = path.join(Global.Path.home, '.claude');
  const credentialsPath = path.join(claudeDir, '.credentials.json');
  const statePath = path.join(claudeDir, '.oauth_state.json');

  /**
   * Generate a cryptographically secure random string
   */
  function generateRandomString(length: number): string {
    return crypto.randomBytes(length).toString('base64url');
  }

  /**
   * Generate PKCE code challenge from code verifier
   */
  function generateCodeChallenge(verifier: string): string {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
  }

  /**
   * Generate authorization URL with PKCE parameters
   *
   * @returns Object containing the authorization URL and state data to save
   */
  export function generateAuthUrl(): { url: string; state: OAuthState } {
    // Generate PKCE values
    const codeVerifier = generateRandomString(32);
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateRandomString(32);

    // Build authorization URL
    const params = new URLSearchParams({
      client_id: Config.clientId,
      redirect_uri: Config.redirectUri,
      response_type: 'code',
      scope: Config.scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const url = `${Config.authorizationUrl}?${params.toString()}`;

    // State expires in 10 minutes
    const oauthState: OAuthState = {
      state,
      codeVerifier,
      expiresAt: Date.now() + 10 * 60 * 1000,
    };

    return { url, state: oauthState };
  }

  /**
   * Save OAuth state for later code exchange
   */
  export async function saveState(state: OAuthState): Promise<void> {
    await Bun.write(statePath, JSON.stringify(state, null, 2));
    log.info(() => ({
      message: 'saved oauth state',
      expiresAt: new Date(state.expiresAt).toISOString(),
    }));
  }

  /**
   * Load saved OAuth state
   */
  export async function loadState(): Promise<OAuthState | undefined> {
    try {
      const file = Bun.file(statePath);
      if (!(await file.exists())) {
        return undefined;
      }
      const content = await file.json();
      const parsed = OAuthState.parse(content);

      if (parsed.expiresAt < Date.now()) {
        log.warn(() => ({ message: 'oauth state expired' }));
        await clearState();
        return undefined;
      }

      return parsed;
    } catch (error) {
      log.error(() => ({ message: 'failed to load oauth state', error }));
      return undefined;
    }
  }

  /**
   * Clear saved OAuth state
   */
  export async function clearState(): Promise<void> {
    try {
      const file = Bun.file(statePath);
      if (await file.exists()) {
        await Bun.write(statePath, '');
        // Delete the file
        const fs = await import('fs/promises');
        await fs.unlink(statePath).catch(() => {});
      }
    } catch (error) {
      log.error(() => ({ message: 'failed to clear oauth state', error }));
    }
  }

  /**
   * Exchange authorization code for tokens
   *
   * @param code - Authorization code from OAuth callback
   * @param codeVerifier - PKCE code verifier
   * @returns Token response from OAuth server
   */
  export async function exchangeCode(
    code: string,
    codeVerifier: string
  ): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: Config.clientId,
      redirect_uri: Config.redirectUri,
      code,
      code_verifier: codeVerifier,
    });

    log.info(() => ({
      message: 'exchanging authorization code for tokens',
    }));

    const response = await fetch(Config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      log.error(() => ({
        message: 'token exchange failed',
        status: response.status,
        error,
      }));
      throw new Error(`Token exchange failed: ${response.status} ${error}`);
    }

    const data = await response.json();
    return TokenResponse.parse(data);
  }

  /**
   * Save credentials to ~/.claude/.credentials.json
   *
   * @param tokens - Token response from OAuth server
   */
  export async function saveCredentials(tokens: TokenResponse): Promise<void> {
    // Ensure .claude directory exists
    const fs = await import('fs/promises');
    await fs.mkdir(claudeDir, { recursive: true });

    // Load existing credentials if any
    let existing: Credentials = {};
    try {
      const file = Bun.file(credentialsPath);
      if (await file.exists()) {
        existing = await file.json();
      }
    } catch {
      // Ignore errors reading existing credentials
    }

    // Update with new OAuth credentials
    const credentials: Credentials = {
      ...existing,
      claudeAiOauth: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
        scopes: tokens.scope?.split(' '),
        subscriptionType: 'unknown', // Will be populated from API response
      },
    };

    await Bun.write(credentialsPath, JSON.stringify(credentials, null, 2));
    log.info(() => ({
      message: 'saved credentials',
      expiresAt: new Date(credentials.claudeAiOauth!.expiresAt).toISOString(),
    }));
  }

  /**
   * Get stored OAuth credentials
   *
   * @returns OAuth credentials if available, undefined otherwise
   */
  export async function getCredentials(): Promise<
    Credentials['claudeAiOauth'] | undefined
  > {
    try {
      const file = Bun.file(credentialsPath);
      if (!(await file.exists())) {
        log.info(() => ({
          message: 'credentials file not found',
          path: credentialsPath,
        }));
        return undefined;
      }

      const content = await file.json();
      const parsed = Credentials.parse(content);

      if (!parsed.claudeAiOauth) {
        log.info(() => ({
          message: 'no claudeAiOauth credentials found',
        }));
        return undefined;
      }

      // Check if token is expired
      if (parsed.claudeAiOauth.expiresAt < Date.now()) {
        log.warn(() => ({
          message: 'token expired',
          expiresAt: new Date(parsed.claudeAiOauth.expiresAt).toISOString(),
        }));
        // TODO: Implement token refresh using refreshToken
        // For now, user needs to re-authenticate
      }

      log.info(() => ({
        message: 'loaded oauth credentials',
        subscriptionType: parsed.claudeAiOauth.subscriptionType,
        scopes: parsed.claudeAiOauth.scopes,
      }));

      return parsed.claudeAiOauth;
    } catch (error) {
      log.error(() => ({ message: 'failed to read credentials', error }));
      return undefined;
    }
  }

  /**
   * Get access token for API requests
   */
  export async function getAccessToken(): Promise<string | undefined> {
    const creds = await getCredentials();
    return creds?.accessToken;
  }

  /**
   * Check if OAuth credentials are available and valid
   */
  export async function isAuthenticated(): Promise<boolean> {
    const creds = await getCredentials();
    if (!creds?.accessToken) return false;

    // Check if not expired (with 5 minute buffer)
    return creds.expiresAt > Date.now() + 5 * 60 * 1000;
  }

  /**
   * Complete the OAuth flow by exchanging the authorization code
   *
   * @param code - Authorization code from OAuth callback
   * @returns Success status
   */
  export async function completeAuth(code: string): Promise<boolean> {
    const state = await loadState();
    if (!state) {
      log.error(() => ({
        message: 'no oauth state found - please start login flow first',
      }));
      return false;
    }

    try {
      const tokens = await exchangeCode(code, state.codeVerifier);
      await saveCredentials(tokens);
      await clearState();
      log.info(() => ({
        message: 'authentication completed successfully',
      }));
      return true;
    } catch (error) {
      log.error(() => ({
        message: 'failed to complete authentication',
        error,
      }));
      await clearState();
      return false;
    }
  }

  /**
   * Refresh the access token using the refresh token
   */
  export async function refreshToken(): Promise<boolean> {
    const creds = await getCredentials();
    if (!creds?.refreshToken) {
      log.error(() => ({ message: 'no refresh token available' }));
      return false;
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: Config.clientId,
      refresh_token: creds.refreshToken,
    });

    log.info(() => ({ message: 'refreshing access token' }));

    try {
      const response = await fetch(Config.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!response.ok) {
        const error = await response.text();
        log.error(() => ({
          message: 'token refresh failed',
          status: response.status,
          error,
        }));
        return false;
      }

      const tokens = TokenResponse.parse(await response.json());
      await saveCredentials(tokens);
      log.info(() => ({ message: 'token refreshed successfully' }));
      return true;
    } catch (error) {
      log.error(() => ({ message: 'failed to refresh token', error }));
      return false;
    }
  }

  /**
   * Create a custom fetch function that uses OAuth Bearer token authentication
   */
  export function createAuthenticatedFetch(accessToken: string): typeof fetch {
    return async (url, init) => {
      const headers = new Headers(init?.headers);
      // Remove x-api-key if present and add Authorization Bearer
      headers.delete('x-api-key');
      headers.set('Authorization', `Bearer ${accessToken}`);
      // Add OAuth beta header
      const existingBeta = headers.get('anthropic-beta');
      if (existingBeta) {
        headers.set('anthropic-beta', `${Config.betaHeader},${existingBeta}`);
      } else {
        headers.set('anthropic-beta', Config.betaHeader);
      }
      return fetch(url, { ...init, headers });
    };
  }
}
