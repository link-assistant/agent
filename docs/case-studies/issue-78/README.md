# Case Study: Issue #78 - Google OAuth Authorization Not Working

## Issue Summary

**Title:** "Не работает авторизация в Google" (Google authentication not working)
**Reporter:** @andchir
**Status:** Resolved
**Date Filed:** December 2025
**Date Resolved:** December 2025

**Problem Statement:** Google OAuth authorization doesn't work because it redirects to `localhost:0`, which is an invalid port caused by a race condition in the code.

## Timeline of Events

1. User attempts to authenticate with Google using `agent auth login`
2. Browser opens with Google OAuth consent screen
3. User completes Google authentication
4. Google attempts to redirect to `http://localhost:0/oauth/callback`
5. Connection fails because port 0 is invalid
6. User sees "connection refused" error in browser
7. CLI remains waiting for authentication that never arrives

## Root Cause Analysis

### Primary Bug: Race Condition in Port Assignment

The core issue was located in `src/auth/plugins.ts` in the `GooglePlugin.authorize()` function.

#### The Bug

The original code had a race condition where the redirect URI was built **before** the server port was actually assigned:

```typescript
async authorize() {
  const server = http.createServer();
  let serverPort = 0;  // Port initialized to 0

  const authPromise = new Promise((resolve, reject) => {
    // Server request handler setup...

    server.listen(0, () => {
      const address = server.address() as net.AddressInfo;
      serverPort = address.port;  // Port assigned asynchronously in callback
    });
  });

  // BUG: redirectUri uses serverPort BEFORE it's assigned!
  const redirectUri = `http://localhost:${serverPort}/oauth/callback`;
  // serverPort is still 0 here because server.listen() callback hasn't fired
```

#### Technical Explanation

1. `serverPort` is initialized to `0`
2. `server.listen(0, callback)` tells the OS to assign an available port
3. The port assignment happens in an **asynchronous callback**
4. The code immediately proceeds to build the redirect URI
5. At this point, `serverPort` is still `0` because the callback hasn't fired
6. The authorization URL sent to Google contains `http://localhost:0/oauth/callback`
7. Port 0 is an invalid destination - connections fail

### Why Not Use Out-of-Band (OOB) Flow?

An initial fix attempt tried to use Google's out-of-band OAuth flow (`urn:ietf:wg:oauth:2.0:oob:auto`). However, this approach is **incorrect** because:

> **Google deprecated the OOB flow in October 2022 and it is no longer supported.**
> See: [Out-Of-Band (OOB) flow Migration Guide](https://developers.google.com/identity/protocols/oauth2/resources/oob-migration)

The OOB flow was blocked for new OAuth clients starting February 28, 2022, and fully deprecated by January 31, 2023.

## Correct Solution: Fix Port Assignment Race Condition

### Implementation

The fix ensures the port is assigned **before** building the redirect URI:

```typescript
/**
 * Get an available port for the OAuth callback server.
 * Supports configurable port via GOOGLE_OAUTH_CALLBACK_PORT environment variable.
 */
async function getGoogleOAuthPort(): Promise<number> {
  // Check for environment variable override (useful for containers/firewalls)
  const portStr = process.env['GOOGLE_OAUTH_CALLBACK_PORT'];
  if (portStr) {
    const port = parseInt(portStr, 10);
    if (!isNaN(port) && port > 0 && port <= 65535) {
      return port;
    }
  }

  // Discover an available port by binding to port 0
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const address = server.address() as net.AddressInfo;
      const port = address.port;
      server.close(() => resolve(port));  // Only resolves after port is known
    });
    server.on('error', reject);
  });
}

async authorize() {
  // Get an available port BEFORE starting the server
  const serverPort = await getGoogleOAuthPort();
  const redirectUri = `http://localhost:${serverPort}/oauth/callback`;
  // Now serverPort is definitely valid
```

### Key Changes

1. **Created `getGoogleOAuthPort()` function**: Discovers an available port and waits for it to be assigned
2. **Port is assigned before redirect URI is built**: Eliminates the race condition
3. **Added environment variable support**: `OAUTH_CALLBACK_PORT` (Gemini CLI compatible) and `GOOGLE_OAUTH_CALLBACK_PORT`
4. **Server listens on pre-determined port**: No race condition with port assignment

### Additional Improvements (December 2025 Update)

Based on review of the [Gemini CLI implementation](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/oauth2.ts), additional authentication modes were added:

1. **Manual Code Entry Mode**: For headless environments (SSH, Docker, WSL), uses Google's Code Assist redirect URI (`https://codeassist.google.com/authcode`) which displays the authorization code for manual copy/paste
2. **OAUTH_CALLBACK_HOST support**: Allows binding to different hosts (e.g., `0.0.0.0` in Docker)
3. **NO_BROWSER environment variable**: When set to `true`, users can opt for manual code entry flow

#### Environment Variables

| Variable                     | Description                                                    |
| ---------------------------- | -------------------------------------------------------------- |
| `OAUTH_CALLBACK_PORT`        | Fixed port for OAuth callback server (Gemini CLI compatible)   |
| `GOOGLE_OAUTH_CALLBACK_PORT` | Alternative name for callback port (legacy support)            |
| `OAUTH_CALLBACK_HOST`        | Host to bind callback server to (default: localhost)           |
| `NO_BROWSER`                 | Set to `true` to use manual code entry instead of browser flow |

## Comparison with Gemini CLI

The official [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) implementation uses the same approach:

```typescript
// From gemini-cli/packages/core/src/code_assist/oauth2.ts
export function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const address = server.address()! as net.AddressInfo;
      port = address.port;
    });
    server.on('close', () => resolve(port)); // Only resolves after port is known
  });
}
```

## Related Issues in Gemini CLI

1. **[Issue #2515](https://github.com/google-gemini/gemini-cli/issues/2515)**: OAuth Authentication Challenges in Containerized Environments
   - Dynamic port makes Docker port mapping challenging
   - Solution: `--network host` mode or environment variable for static port

2. **[Issue #2547](https://github.com/google-gemini/gemini-cli/issues/2547)**: Failed to Log In via 'Login with Google' on macOS
   - Redirect loop issues on macOS
   - Related to firewall/localhost resolution issues

## Testing Plan

1. **Unit Test**: Verify port is assigned before redirect URI is built
2. **Integration Test**: Complete OAuth flow with local server
3. **Manual Test**: Verify browser redirect works correctly
4. **Container Test**: Test with `GOOGLE_OAUTH_CALLBACK_PORT` environment variable
5. **Edge Case Test**: Test port discovery when ports are in use

## Verification

The fix was verified by:

1. **Code Review**: Ensured proper async/await flow for port discovery
2. **Logic Review**: OAuth flow follows Google's localhost redirect specification
3. **Linting**: ESLint checks pass
4. **Type Checking**: TypeScript compilation successful

## References

- [Google OAuth 2.0 for Desktop Applications](https://developers.google.com/identity/protocols/oauth2#installed)
- [OOB Flow Deprecation Migration Guide](https://developers.google.com/identity/protocols/oauth2/resources/oob-migration)
- [Gemini CLI OAuth2 Implementation](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/oauth2.ts)
- [Issue #2515: OAuth Challenges in Containers](https://github.com/google-gemini/gemini-cli/issues/2515)
- [Issue #2547: macOS Redirect Loop](https://github.com/google-gemini/gemini-cli/issues/2547)

## Impact

- **Severity**: High - Google OAuth authentication completely broken
- **Affected Users**: All users attempting to use Google AI Pro/Ultra subscription via OAuth
- **Workaround**: Use manual API key entry instead of OAuth (before fix)
- **Resolution**: Fixed race condition in port assignment
