# Claude OAuth Provider

The Claude OAuth provider allows you to use your Claude Pro or Max subscription with the agent CLI through OAuth 2.0 authentication (PKCE flow).

## Quick Start

### Option 1: Authenticate with Agent CLI (Recommended)

```bash
# Authenticate with Claude OAuth
agent auth claude

# Use with default Claude model
echo "hello" | agent --use-existing-claude-oauth

# Or specify a model explicitly
echo "hello" | agent --model claude-oauth/claude-sonnet-4-5
```

### Option 2: Use Existing Claude Code CLI Credentials

If you already have Claude Code CLI installed and authenticated:

```bash
# Claude Code CLI stores credentials in ~/.claude/.credentials.json
# Simply use the --use-existing-claude-oauth flag
echo "hello" | agent --use-existing-claude-oauth
```

### Option 3: Environment Variable

```bash
export CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat01-..."
echo "hello" | agent --model claude-oauth/claude-sonnet-4-5
```

## Authentication Commands

### Login

```bash
agent auth claude
```

This will:
1. Generate an authorization URL with PKCE
2. Open your browser to authenticate with Claude
3. Ask you to paste the authorization code
4. Exchange the code for tokens
5. Store credentials in `~/.claude/.credentials.json`

### Check Status

```bash
agent auth claude-status
```

Shows current authentication status including:
- Whether you're authenticated
- Subscription type
- Token expiration

### Refresh Token

```bash
agent auth claude-refresh
```

Refreshes your access token using the stored refresh token.

## Available Models

The Claude OAuth provider gives you access to all Anthropic models:

| Model | Model ID | Description |
|-------|----------|-------------|
| Claude Sonnet 4.5 | `claude-oauth/claude-sonnet-4-5` | Latest Claude Sonnet |
| Claude Opus 4.1 | `claude-oauth/claude-opus-4-1` | Most capable Claude model |
| Claude Haiku 4.5 | `claude-oauth/claude-haiku-4-5` | Fastest Claude model |
| Claude Sonnet 3.5 v2 | `claude-oauth/claude-3-5-sonnet-20241022` | Previous generation Sonnet |

## Token Storage

OAuth tokens are stored in:

```
~/.claude/.credentials.json
```

This is the same location used by Claude Code CLI, allowing shared authentication.

The format is:
```json
{
  "claudeAiOauth": {
    "accessToken": "sk-ant-oat01-...",
    "refreshToken": "sk-ant-ort01-...",
    "expiresAt": 1765759825273,
    "scopes": ["org:create_api_key", "user:profile", "user:inference"],
    "subscriptionType": "max"
  }
}
```

## CLI Options

| Option | Description |
|--------|-------------|
| `--use-existing-claude-oauth` | Use existing credentials from `~/.claude/.credentials.json` |
| `--model claude-oauth/<model>` | Use specific Claude model with OAuth |

## Differences from Direct Anthropic API

| Feature | Claude OAuth | Anthropic API |
|---------|--------------|---------------|
| Token Format | `sk-ant-oat...` (OAuth) | `sk-ant-api...` (API key) |
| Authentication | Bearer token | x-api-key header |
| Billing | Claude Pro/Max subscription | Pay-as-you-go through Console |
| Setup | `agent auth claude` | Generate API key in Console |
| Environment Variable | `CLAUDE_CODE_OAUTH_TOKEN` | `ANTHROPIC_API_KEY` |

## Technical Details

### OAuth Flow

The implementation uses OAuth 2.0 with PKCE (Proof Key for Code Exchange):

1. **Authorization URL Generation**: Creates URL with PKCE code verifier/challenge
2. **User Authentication**: User authenticates in browser and authorizes
3. **Code Exchange**: Authorization code exchanged for access/refresh tokens
4. **Token Storage**: Tokens saved to `~/.claude/.credentials.json`

### OAuth Endpoints

| Endpoint | URL |
|----------|-----|
| Authorization | `https://claude.ai/oauth/authorize` |
| Token Exchange | `https://console.anthropic.com/v1/oauth/token` |
| Redirect URI | `https://console.anthropic.com/oauth/code/callback` |

### API Authentication

OAuth tokens require special handling:
- Uses `Authorization: Bearer <token>` header
- Requires `anthropic-beta: oauth-2025-04-20` header

## Alternatives

### Direct Anthropic API Key

If you prefer pay-as-you-go billing:

```bash
export ANTHROPIC_API_KEY="sk-ant-api03-..."
echo "hello" | agent --model anthropic/claude-sonnet-4-5
```

Get an API key from the [Anthropic Console](https://console.anthropic.com/).

### OpenCode Provider

The OpenCode provider includes Claude models:

```bash
echo "hello" | agent --model opencode/claude-sonnet-4-5
```

## Troubleshooting

### "No Claude OAuth credentials found"

Run `agent auth claude` to authenticate.

### "Token expired"

Run `agent auth claude-refresh` or re-authenticate with `agent auth claude`.

### "OAuth authentication is currently not supported"

This error may occur if Anthropic's API has restrictions on OAuth tokens. Try:
1. Ensure you have Claude Pro or Max subscription
2. Re-authenticate with `agent auth claude`
3. If issue persists, use the `anthropic` provider with an API key instead

## References

- [Claude Code CLI](https://claude.ai/code) - Official CLI with OAuth
- [Anthropic Console](https://console.anthropic.com/) - For API key generation
- [claude-code-login](https://github.com/grll/claude-code-login) - Reference OAuth implementation
