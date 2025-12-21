import { describe, it, expect } from 'bun:test';
import { GeminiOAuth } from '../src/auth/gemini-oauth';

describe('GeminiOAuth', () => {
  describe('generateAuthUrl', () => {
    it('should generate valid auth URL with PKCE', () => {
      const result = GeminiOAuth.generateAuthUrl(3000);

      expect(result.url).toMatch(
        /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/
      );
      expect(result.url).toMatch(
        /client_id=681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j/
      );
      expect(result.url).toMatch(
        /redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Foauth2callback/
      );
      expect(result.url).toMatch(/response_type=code/);
      expect(result.url).toMatch(/code_challenge_method=S256/);

      expect(result.state).toBeDefined();
      expect(result.state.state).toBeDefined();
      expect(result.state.codeVerifier).toBeDefined();
      expect(result.state.redirectUri).toBe(
        'http://localhost:3000/oauth2callback'
      );
      expect(result.state.expiresAt).toBeGreaterThan(Date.now());
    });
  });

  describe('Config', () => {
    it('should have correct OAuth configuration', () => {
      expect(GeminiOAuth.Config.clientId).toBe(
        '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com'
      );
      expect(GeminiOAuth.Config.authorizationUrl).toBe(
        'https://accounts.google.com/o/oauth2/v2/auth'
      );
      expect(GeminiOAuth.Config.tokenUrl).toBe(
        'https://oauth2.googleapis.com/token'
      );
      expect(GeminiOAuth.Config.scopes).toContain(
        'https://www.googleapis.com/auth/cloud-platform'
      );
    });
  });

  describe('Credentials schema', () => {
    it('should validate correct credentials', () => {
      const validCreds = {
        access_token: 'test-token',
        refresh_token: 'refresh-token',
        expiry_date: Date.now() + 3600000,
        token_type: 'Bearer',
        scope: 'test-scope',
      };

      const result = GeminiOAuth.Credentials.safeParse(validCreds);
      expect(result.success).toBe(true);
    });

    it('should reject invalid credentials', () => {
      const invalidCreds = {
        access_token: 123, // should be string
        refresh_token: 'refresh-token',
      };

      const result = GeminiOAuth.Credentials.safeParse(invalidCreds);
      expect(result.success).toBe(false);
    });
  });

  describe('OAuthState schema', () => {
    it('should validate correct state', () => {
      const validState = {
        state: 'test-state',
        codeVerifier: 'test-verifier',
        redirectUri: 'http://localhost:3000/callback',
        expiresAt: Date.now() + 600000,
      };

      const result = GeminiOAuth.OAuthState.safeParse(validState);
      expect(result.success).toBe(true);
    });
  });

  describe('TokenResponse schema', () => {
    it('should validate correct token response', () => {
      const validResponse = {
        access_token: 'test-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'test-scope',
      };

      const result = GeminiOAuth.TokenResponse.safeParse(validResponse);
      expect(result.success).toBe(true);
    });
  });
});
