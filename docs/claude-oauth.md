# Authentication Guide

The agent CLI supports OAuth authentication for providers that offer subscription-based access, including:

- **Anthropic** (Claude Pro/Max subscription)
- **GitHub Copilot** (GitHub.com and Enterprise)

## Quick Start

### Authenticate with a Provider

```bash
# Interactive login - select your provider
agent auth login

# Example: Select "Anthropic" > "Claude Pro/Max"
# Example: Select "GitHub Copilot" > "Login with GitHub Copilot"
```

### Check Authentication Status

```bash
# List all configured credentials
agent auth list

# Check detailed status (experimental)
agent auth status
```

### Use Authenticated Providers

```bash
# Use Claude with OAuth (after agent auth login with Anthropic)
echo "hello" | agent --model anthropic/claude-sonnet-4-5

# Use GitHub Copilot (after agent auth login with GitHub Copilot)
echo "hello" | agent --model github-copilot/gpt-4o
```

## Auth Commands

### `agent auth login`

Interactive login to any supported provider.

```bash
agent auth login
```

This will:

1. Show a list of available providers
2. For OAuth providers (Anthropic, GitHub Copilot): Open browser for authentication
3. For API key providers: Prompt for API key entry
4. Store credentials securely in `~/.local/share/agent/auth.json`

### `agent auth list`

List all configured credentials.

```bash
agent auth list
# Output:
# ◇ Credentials ~/.local/share/agent/auth.json
# │
# ◆ Anthropic oauth
# ◆ GitHub Copilot oauth
# │
# └ 2 credentials
```

### `agent auth logout`

Remove credentials for a provider.

```bash
agent auth logout
# Select provider to log out from
```

### `agent auth status`

Check authentication status for all providers (experimental).

```bash
agent auth status
# Shows token expiration, etc.
```

## Provider-Specific Details

### Anthropic (Claude Pro/Max)

Claude Pro/Max subscribers can authenticate via OAuth:

```bash
agent auth login
# Select: Anthropic
# Select: Claude Pro/Max
# Follow browser prompts
# Paste authorization code
```

**Login methods:**

- **Claude Pro/Max** - OAuth login for subscription users (recommended)
- **Create an API Key** - Generate an API key via OAuth
- **Manually enter API Key** - Enter existing API key

After login, use any Anthropic model:

```bash
echo "hello" | agent --model anthropic/claude-sonnet-4-5
echo "hello" | agent --model anthropic/claude-opus-4-1
```

### GitHub Copilot

GitHub Copilot subscribers (individual or enterprise) can authenticate:

```bash
agent auth login
# Select: GitHub Copilot
# Select: GitHub.com or GitHub Enterprise
# Follow device code flow
```

The device code flow will:

1. Show a verification URL and code
2. Wait for you to authorize in browser
3. Automatically complete once authorized

After login, use GitHub Copilot models:

```bash
echo "hello" | agent --model github-copilot/gpt-4o
echo "hello" | agent --model github-copilot/claude-sonnet-4-5
```

### Other Providers (API Key)

For providers without OAuth support, enter API keys directly:

```bash
agent auth login
# Select provider (OpenAI, Google, OpenRouter, etc.)
# Enter API key when prompted
```

Or use environment variables:

```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-api03-..."
export GOOGLE_GENERATIVE_AI_API_KEY="..."
```

## Using Claude Code CLI Credentials

If you've already authenticated with Claude Code CLI, you can use those credentials:

```bash
# Claude Code CLI stores credentials in ~/.claude/.credentials.json
# Use the --use-existing-claude-oauth flag
echo "hello" | agent --use-existing-claude-oauth
```

This option:

- Reads OAuth tokens from `~/.claude/.credentials.json`
- Automatically uses the `claude-oauth` provider
- Defaults to `claude-sonnet-4-5` model if no model specified

## Credential Storage

### Agent CLI Credentials

Credentials from `agent auth login` are stored in:

```
~/.local/share/agent/auth.json
```

Format:

```json
{
  "anthropic": {
    "type": "oauth",
    "refresh": "sk-ant-ort01-...",
    "access": "sk-ant-oat01-...",
    "expires": 1765759825273
  },
  "github-copilot": {
    "type": "oauth",
    "refresh": "gho_...",
    "access": "...",
    "expires": 1765759825273
  }
}
```

### Claude Code CLI Credentials

Claude Code CLI credentials (used with `--use-existing-claude-oauth`) are in:

```
~/.claude/.credentials.json
```

## Token Refresh

OAuth tokens are automatically refreshed when expired:

- Anthropic: Uses refresh token to get new access token
- GitHub Copilot: Uses access token to get Copilot-specific token

No manual refresh is needed - the agent handles this automatically.

## Environment Variables

| Provider          | Environment Variable           |
| ----------------- | ------------------------------ |
| Anthropic (API)   | `ANTHROPIC_API_KEY`            |
| Anthropic (OAuth) | `CLAUDE_CODE_OAUTH_TOKEN`      |
| OpenAI            | `OPENAI_API_KEY`               |
| Google            | `GOOGLE_GENERATIVE_AI_API_KEY` |
| OpenRouter        | `OPENROUTER_API_KEY`           |
| GitHub Copilot    | (OAuth only, no env var)       |

## Troubleshooting

### "No credentials found"

Run `agent auth login` to authenticate with a provider.

### "Token expired"

Tokens are auto-refreshed. If you see this error, try:

1. `agent auth logout` for the provider
2. `agent auth login` to re-authenticate

### "Failed to authorize"

- Ensure you have an active subscription (Claude Pro/Max, GitHub Copilot)
- Check your network connection
- Try again with `agent auth login`

### OAuth vs API Key

| Feature      | OAuth                 | API Key         |
| ------------ | --------------------- | --------------- |
| Billing      | Subscription-based    | Pay-as-you-go   |
| Setup        | Browser authorization | Copy/paste key  |
| Token Format | `sk-ant-oat...`       | `sk-ant-api...` |
| Auto-refresh | Yes                   | N/A             |

## References

- [Claude Code CLI](https://claude.ai/code) - Official Claude CLI with OAuth
- [Anthropic Console](https://console.anthropic.com/) - API key management
- [GitHub Copilot](https://github.com/features/copilot) - GitHub AI assistant
