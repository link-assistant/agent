import crypto from 'crypto';
import path from 'path';
import { Global } from '../global';
import { Log } from '../util/log';
import z from 'zod';

/**
 * Gemini OAuth Module
 *
 * Implements OAuth 2.0 with PKCE for Gemini authentication.
 * This allows using Gemini subscriptions for API access.
 *
 * OAuth Flow:
 * 1. Generate PKCE code verifier and challenge
 * 2. Open browser to authorization URL
 * 3. User authenticates and authorizes
 * 4. Receive authorization code via redirect
 * 5. Exchange code for tokens
 * 6. Store tokens in ~/.gemini/.credentials.json
 *
 * References:
 * - Gemini CLI uses the same OAuth flow
 * - https://github.com/google-gemini/gemini-cli
 */
export namespace GeminiOAuth {
  const log = Log.create({ service: 'gemini-oauth' });

  /**
   * OAuth Configuration
   * These values are from the official Gemini CLI implementation
   */
  export const Config = {
    // OAuth endpoints
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    redirectUri: 'http://localhost:3000/oauth2callback', // Will be overridden with dynamic port

    // OAuth client - this is the same client ID used by Gemini CLI
    clientId:
      '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com',
    clientSecret: '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',

     // Requested scopes for API access
     scopes: [
       'https://www.googleapis.com/auth/cloud-platform',
       'https://www.googleapis.com/auth/userinfo.email',
       'https://www.googleapis.com/auth/userinfo.profile',
     ],

    // Success/failure URLs for user feedback
    successUrl:
      'https://developers.google.com/gemini-code-assist/auth_success_gemini',
    failureUrl:
      'https://developers.google.com/gemini-code-assist/auth_failure_gemini',
  } as const;

  /**
   * Schema for OAuth credentials stored in ~/.gemini/.credentials.json
   */
  export const Credentials = z.object({
    access_token: z.string(),
    refresh_token: z.string().optional(),
    expiry_date: z.number().optional(),
    token_type: z.string().optional(),
    scope: z.string().optional(),
  });

  export type Credentials = z.infer<typeof Credentials>;

  /**
   * Schema for OAuth state file (temporary, during auth flow)
   */
  export const OAuthState = z.object({
    state: z.string(),
    codeVerifier: z.string(),
    redirectUri: z.string(),
    expiresAt: z.number(),
  });

  export type OAuthState = z.infer<typeof OAuthState>;

  /**
   * Schema for token response from OAuth server
   */
  export const TokenResponse = z.object({
    access_token: z.string(),
    token_type: z.string().optional(),
    expires_in: z.number().optional(),
    refresh_token: z.string().optional(),
    scope: z.string().optional(),
  });

  export type TokenResponse = z.infer<typeof TokenResponse>;

  /**
   * Paths for credential and state storage
   */
  const geminiDir = path.join(Global.Path.home, '.gemini');
  const credentialsPath = path.join(geminiDir, '.credentials.json');
  const statePath = path.join(geminiDir, '.oauth_state.json');

  /**
   * Generate a cryptographically secure random string
   */
  function generateRandomString(length: number): string {
    return crypto
      .randomBytes(length)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  /**
   * Generate PKCE code challenge from code verifier
   */
  function generateCodeChallenge(verifier: string): string {
    return crypto
      .createHash('sha256')
      .update(verifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  /**
   * Generate authorization URL with PKCE parameters
   *
   * @param redirectPort - Port for the local callback server
   * @returns Object containing the authorization URL and state data to save
   */
  export function generateAuthUrl(redirectPort: number): {
    url: string;
    state: OAuthState;
  } {
    // Generate PKCE values
    const codeVerifier = generateRandomString(32);
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateRandomString(32);
    const redirectUri = `http://localhost:${redirectPort}/oauth2callback`;

    // Build authorization URL
    const params = new URLSearchParams({
      client_id: Config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: Config.scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      access_type: 'offline', // Request refresh token
    });

    const url = `${Config.authorizationUrl}?${params.toString()}`;

    // State expires in 10 minutes
    const oauthState: OAuthState = {
      state,
      codeVerifier,
      redirectUri,
      expiresAt: Date.now() + 10 * 60 * 1000,
    };

    return { url, state: oauthState };
  }

  /**
   * Save OAuth state for later code exchange
   */
  export async function saveState(state: OAuthState): Promise<void> {
    // Ensure .gemini directory exists
    const fs = await import('fs/promises');
    await fs.mkdir(geminiDir, { recursive: true });

    await Bun.write(statePath, JSON.stringify(state, null, 2));
    log.info('saved oauth state', {
      expiresAt: new Date(state.expiresAt).toISOString(),
    });
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
        log.warn('oauth state expired');
        await clearState();
        return undefined;
      }

      return parsed;
    } catch (error) {
      log.error('failed to load oauth state', { error });
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
      log.error('failed to clear oauth state', { error });
    }
  }

  /**
   * Exchange authorization code for tokens
   *
   * @param code - Authorization code from OAuth callback
   * @param codeVerifier - PKCE code verifier
   * @param redirectUri - Redirect URI used in the authorization request
   * @returns Token response from OAuth server
   */
  export async function exchangeCode(
    code: string,
    codeVerifier: string,
    redirectUri: string
  ): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: Config.clientId,
      client_secret: Config.clientSecret,
      redirect_uri: redirectUri,
      code,
      code_verifier: codeVerifier,
    });

    log.info('exchanging authorization code for tokens');

    const response = await fetch(Config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      log.error('token exchange failed', { status: response.status, error });
      throw new Error(`Token exchange failed: ${response.status} ${error}`);
    }

    const data = await response.json();
    return TokenResponse.parse(data);
  }

  /**
   * Save credentials to ~/.gemini/.credentials.json
   *
   * @param tokens - Token response from OAuth server
   */
  export async function saveCredentials(tokens: TokenResponse): Promise<void> {
    // Ensure .gemini directory exists
    const fs = await import('fs/promises');
    await fs.mkdir(geminiDir, { recursive: true });

    // Load existing credentials if any
    let existing: Credentials = {} as any;
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
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type || 'Bearer',
      scope: tokens.scope,
    };

    if (tokens.expires_in) {
      credentials.expiry_date = Date.now() + tokens.expires_in * 1000;
    }

    await Bun.write(credentialsPath, JSON.stringify(credentials, null, 2));
    log.info('saved credentials', {
      expiresAt: credentials.expiry_date
        ? new Date(credentials.expiry_date).toISOString()
        : 'unknown',
    });
  }

  /**
   * Get stored OAuth credentials
   *
   * @returns OAuth credentials if available, undefined otherwise
   */
  export async function getCredentials(): Promise<Credentials | undefined> {
    try {
      const file = Bun.file(credentialsPath);
      if (!(await file.exists())) {
        log.info('credentials file not found', { path: credentialsPath });
        return undefined;
      }

      const content = await file.json();
      const parsed = Credentials.parse(content);

      // Check if token is expired
      if (parsed.expiry_date && parsed.expiry_date < Date.now()) {
        log.warn('token expired', {
          expiresAt: new Date(parsed.expiry_date).toISOString(),
        });
        // Token refresh is handled by the OAuth loader in plugins.ts
      }

      log.info('loaded oauth credentials', {
        hasRefreshToken: !!parsed.refresh_token,
        scope: parsed.scope,
      });

      return parsed;
    } catch (error) {
      log.error('failed to read credentials', { error });
      return undefined;
    }
  }

  /**
   * Get access token for API requests
   */
  export async function getAccessToken(): Promise<string | undefined> {
    const creds = await getCredentials();
    return creds?.access_token;
  }

  /**
   * Check if OAuth credentials are available and valid
   */
  export async function isAuthenticated(): Promise<boolean> {
    const creds = await getCredentials();
    if (!creds?.access_token) return false;

    // Check if not expired (with 5 minute buffer)
    if (creds.expiry_date) {
      return creds.expiry_date > Date.now() + 5 * 60 * 1000;
    }

    // If no expiry date, assume valid
    return true;
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
      log.error('no oauth state found - please start login flow first');
      return false;
    }

    try {
      const tokens = await exchangeCode(
        code,
        state.codeVerifier,
        state.redirectUri
      );
      await saveCredentials(tokens);
      await clearState();
      log.info('authentication completed successfully');
      return true;
    } catch (error) {
      log.error('failed to complete authentication', { error });
      await clearState();
      return false;
    }
  }

  /**
   * Refresh the access token using the refresh token
   */
  export async function refreshToken(): Promise<boolean> {
    const creds = await getCredentials();
    if (!creds?.refresh_token) {
      log.error('no refresh token available');
      return false;
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: Config.clientId,
      client_secret: Config.clientSecret,
      refresh_token: creds.refresh_token,
    });

    log.info('refreshing access token');

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
        log.error('token refresh failed', { status: response.status, error });
        return false;
      }

      const tokens = TokenResponse.parse(await response.json());
      await saveCredentials(tokens);
      log.info('token refreshed successfully');
      return true;
    } catch (error) {
      log.error('failed to refresh token', { error });
      return false;
    }
  }

  /**
   * Create a custom fetch function that uses OAuth Bearer token authentication
   */
  export function createAuthenticatedFetch(accessToken: string): typeof fetch {
    return async (url, init) => {
      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${accessToken}`);
      return fetch(url, { ...init, headers });
    };
  }
}
