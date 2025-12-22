# Google AI Pro/Ultra OAuth Authentication

This guide explains how to authenticate with Google AI using OAuth, which is required for Google AI Pro and Google AI Ultra subscribers.

## Quick Start

```bash
agent auth google
```

Select "Google AI Pro/Ultra (OAuth)" when prompted.

## Authentication Methods

### 1. OAuth Login with Browser (Recommended)

If you have a Google AI Pro or Google AI Ultra subscription, use OAuth authentication:

1. Run `agent auth google`
2. Select "Google AI Pro/Ultra (OAuth - Browser)"
3. A browser window will open with Google's login page
4. Sign in with your Google account that has the subscription
5. Authorize the application
6. The browser will redirect back automatically and authentication completes

Your credentials will be stored securely and automatically refreshed when needed.

### 2. OAuth Login with Manual Code Entry (Headless/SSH)

For headless environments, SSH sessions, or when browser can't be opened automatically:

1. Run `agent auth google`
2. Select "Google AI Pro/Ultra (OAuth - Manual Code Entry)"
3. Copy the URL displayed and open it in any browser
4. Sign in with your Google account
5. After authorization, copy the authorization code shown on the page
6. Paste the code back into the terminal

This method uses Google's Code Assist redirect (`https://codeassist.google.com/authcode`) which displays the authorization code instead of redirecting to localhost.

### 3. API Key (Alternative)

If you prefer to use an API key instead of OAuth:

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Create an API key
3. Either:
   - Set the environment variable: `GOOGLE_API_KEY=your-key`
   - Run `agent auth google` and select "Manually enter API Key"

## Available Models

After authentication, you can use Gemini models:

- `google/gemini-3-pro` - Gemini 3 Pro (alias for gemini-3-pro-preview)
- `google/gemini-2.5-flash` - Gemini 2.5 Flash
- `google/gemini-2.5-pro` - Gemini 2.5 Pro
- And other models available in the Google AI API

## Subscription Benefits

With Google AI Pro/Ultra subscription via OAuth:

- Access to premium models
- Higher rate limits
- No per-token costs (included in subscription)

## Technical Details

### OAuth Endpoints

- Authorization: `https://accounts.google.com/o/oauth2/v2/auth`
- Token: `https://oauth2.googleapis.com/token`
- Redirect: Localhost callback (`http://localhost:{port}/oauth/callback`)

### Scopes

The following OAuth scopes are requested:

- `https://www.googleapis.com/auth/cloud-platform`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/userinfo.profile`

### Token Storage

OAuth tokens are stored in `~/.local/share/agent/auth.json` with the following structure:

```json
{
  "google": {
    "type": "oauth",
    "refresh": "<refresh_token>",
    "access": "<access_token>",
    "expires": <timestamp_ms>
  }
}
```

### Token Refresh

Tokens are automatically refreshed when:

- The access token is expired
- Within 5 minutes of expiration (for reliability)

## Troubleshooting

### "Token refresh failed"

If you see this error, try re-authenticating:

```bash
agent logout google
agent auth google
```

### "Authorization failed"

Make sure you:

1. Have an active Google AI Pro/Ultra subscription
2. Are using the correct Google account
3. Have granted all requested permissions

### Rate Limiting

Even with a subscription, you may encounter rate limits. The agent will automatically retry with backoff.

## Environment Variables

| Variable                     | Description                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------- |
| `GOOGLE_API_KEY`             | API key for Google AI (alternative to OAuth)                                     |
| `OAUTH_CALLBACK_PORT`        | Fixed port for OAuth callback server (Gemini CLI compatible)                     |
| `GOOGLE_OAUTH_CALLBACK_PORT` | Alternative name for callback port (legacy support)                              |
| `OAUTH_CALLBACK_HOST`        | Host to bind callback server to (e.g., `0.0.0.0` for Docker, default: localhost) |
| `NO_BROWSER`                 | Set to `true` or `1` to skip browser launch and use manual code entry            |

## See Also

- [Google AI Documentation](https://ai.google.dev/gemini-api/docs/oauth)
- [Gemini CLI Authentication](https://google-gemini.github.io/gemini-cli/docs/get-started/authentication.html)
