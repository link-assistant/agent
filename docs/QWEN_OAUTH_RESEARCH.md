# Qwen Coder OAuth Research

This document presents research findings on OAuth implementations across popular CLI agentic tools (Qwen Code, Claude Code, Gemini CLI, OpenCode) and proposes implementation options for integrating Qwen OAuth support into the `@link-assistant/agent` CLI.

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [CLI Tools Comparison](#cli-tools-comparison)
3. [Qwen Code CLI OAuth Implementation](#qwen-code-cli-oauth-implementation)
4. [Claude Code OAuth Implementation](#claude-code-oauth-implementation)
5. [Gemini CLI OAuth Implementation](#gemini-cli-oauth-implementation)
6. [OpenCode CLI OAuth Implementation](#opencode-cli-oauth-implementation)
7. [Credential Storage Locations](#credential-storage-locations)
8. [Implementation Proposal for @link-assistant/agent](#implementation-proposal-for-link-assistantagent)
9. [References](#references)

---

## Executive Summary

### Key Findings

| CLI Tool | OAuth Provider | OAuth Type | Credential Storage | Auto Browser | Device Code Flow |
|----------|---------------|------------|-------------------|--------------|------------------|
| Qwen Code | qwen.ai | Device Code | `~/.qwen/oauth_creds.json` | Yes | Yes |
| Claude Code | Anthropic | PKCE | macOS Keychain / `~/.claude/` | Yes | SSH Port Forward |
| Gemini CLI | Google | PKCE + Web | `~/.gemini/oauth_creds.json` | Yes | User Code Input |
| OpenCode | Multiple (Plugin) | PKCE | `~/.opencode/auth.json` | Yes | Code Input |

### Recommendations

1. **Primary Goal**: Implement Qwen OAuth support compatible with existing Qwen Code CLI credentials
2. **Fallback Location**: Use `~/.agent/qwen/` for credentials when Qwen Code CLI is not installed
3. **Authentication Methods**: Support both OAuth (browser-based) and API key (environment variable) methods

---

## CLI Tools Comparison

### Authentication Flow Types

1. **Web-based OAuth (Browser)**
   - Opens local HTTP server for callback
   - Redirects user to authentication page
   - Receives authorization code via callback
   - Used by: Gemini CLI, Claude Code, OpenCode

2. **Device Code Flow**
   - User visits URL and enters code
   - CLI polls for token
   - Works better in headless environments
   - Used by: Qwen Code CLI

3. **API Key Input**
   - Manual entry via CLI prompt
   - Environment variable support
   - Used by: All tools as fallback

---

## Qwen Code CLI OAuth Implementation

### Overview

Qwen Code CLI implements OAuth using the Device Authorization Grant (RFC 8628), which is well-suited for CLI applications as it doesn't require a local HTTP server.

### OAuth Configuration

| Parameter | Value |
|-----------|-------|
| Base URL | `https://chat.qwen.ai` |
| Device Code Endpoint | `/api/v1/oauth2/device/code` |
| Token Endpoint | `/api/v1/oauth2/token` |
| Client ID | `f0304373b74a44d2b584a3fb70ca9e56` |
| Scope | `openid profile email model.completion` |
| Grant Type | `urn:ietf:params:oauth:grant-type:device_code` |

### Authentication Flow

```
1. CLI requests device code from /api/v1/oauth2/device/code
   - Includes PKCE code_challenge (SHA-256)
   - Returns: device_code, user_code, verification_uri, expires_in

2. User visits verification_uri and enters user_code
   - Browser authentication on qwen.ai

3. CLI polls /api/v1/oauth2/token
   - Uses device_code and code_verifier
   - Returns: access_token, refresh_token, expires_in

4. Tokens cached to ~/.qwen/oauth_creds.json
```

### Credential Storage

**File Location**: `~/.qwen/oauth_creds.json`

**File Format**:
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expiry_date": 1763618628840,
  "resource_url": "https://chat.qwen.ai",
  "token_type": "Bearer"
}
```

**Alternative Storage**: Keychain service `qwen-code-oauth` (for enhanced security)

### Usage Limits (Free Tier)

- 60 requests per minute
- 2,000 requests per day
- No token limits during promotional period
- Model fallback may occur for service quality

### Environment Variables (Non-Interactive Mode)

```bash
# For headless/CI environments
OPENAI_API_KEY="your_api_key_here"
OPENAI_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
OPENAI_MODEL="qwen3-coder-plus"
```

### .env File Support

Search order (first found wins):
1. `.qwen/.env` in current directory
2. `.env` in current directory
3. `~/.qwen/.env` in home directory
4. `~/.env` in home directory

---

## Claude Code OAuth Implementation

### Overview

Claude Code uses PKCE OAuth 2.0 with browser-based authentication. It requires a local browser to complete the OAuth flow.

### OAuth Configuration

| Parameter | Value |
|-----------|-------|
| Authorization URL | `https://console.anthropic.com/oauth/authorize` or `https://claude.ai/oauth/authorize` |
| Token Endpoint | `https://console.anthropic.com/v1/oauth/token` |
| Client ID | `9d1c250a-e61b-44d9-88ed-5944d1962f5e` |
| Scopes | `org:create_api_key`, `user:profile`, `user:inference` |

### Authentication Flow

```
1. CLI opens local HTTP server on random port
2. Generates PKCE code_verifier and code_challenge
3. Opens browser to authorization URL
4. User authenticates on claude.ai
5. Callback received with authorization code
6. Exchange code for access/refresh tokens
7. Store tokens in keychain or file
```

### Credential Storage

- **macOS**: Encrypted macOS Keychain
- **Linux/Windows**: `~/.claude/` directory
- Supports multiple auth types: Claude.ai, API keys, Azure, Bedrock, Vertex

### Remote/Headless Authentication

For SSH or Docker environments, use SSH port forwarding:
```bash
ssh -L 8080:localhost:8080 user@remote-server.com
claude /login
# Copy localhost URL to local browser
```

### Known Limitations

- OAuth tokens are restricted to "Claude Code" only
- Third-party tools cannot directly use Claude Code OAuth tokens
- OpenCode appears to have special whitelisting from Anthropic

---

## Gemini CLI OAuth Implementation

### Overview

Gemini CLI uses Google OAuth 2.0 with PKCE, supporting both web-based and user-code authentication flows.

### OAuth Configuration

| Parameter | Value |
|-----------|-------|
| Client ID | See `reference-gemini-cli/packages/core/src/code_assist/oauth2.ts` |
| Client Secret | See `reference-gemini-cli/packages/core/src/code_assist/oauth2.ts` (public per Google OAuth docs) |
| Scopes | `cloud-platform`, `userinfo.email`, `userinfo.profile` |
| Redirect URI (web) | `http://localhost:{port}/oauth2callback` |
| Redirect URI (code) | `https://codeassist.google.com/authcode` |
| Success URL | `https://developers.google.com/gemini-code-assist/auth_success_gemini` |

### Authentication Methods

1. **Web-based Flow** (default)
   - Opens local HTTP server
   - Opens browser automatically
   - Validates state parameter (CSRF protection)
   - 5-minute timeout

2. **User Code Flow** (NO_BROWSER=true)
   - Displays authorization URL
   - User manually visits and authenticates
   - User pastes authorization code back to CLI

3. **Cloud Shell / ADC**
   - Uses Application Default Credentials
   - Leverages metadata server for GCE environments

### Credential Storage

**File Location**: `~/.gemini/oauth_creds.json` (via `Storage.getOAuthCredsPath()`)

**Alternative**: `GOOGLE_APPLICATION_CREDENTIALS` environment variable

**Format**:
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expiry_date": 1763618628840,
  "token_type": "Bearer",
  "scope": "..."
}
```

### Environment Variables

```bash
# Gemini API Key
GEMINI_API_KEY="..."

# Vertex AI
GOOGLE_CLOUD_PROJECT="..."
GOOGLE_CLOUD_LOCATION="..."
GOOGLE_API_KEY="..."

# Cloud access token override
GOOGLE_CLOUD_ACCESS_TOKEN="..."
```

---

## OpenCode CLI OAuth Implementation

### Overview

OpenCode uses a plugin-based authentication system that supports multiple providers. Default plugins include `opencode-anthropic-auth` and `opencode-copilot-auth`.

### Plugin System

Plugins are npm packages that implement the `@opencode-ai/plugin` interface:

```typescript
auth?: {
  provider: string
  methods: (OAuthMethod | ApiMethod)[]
  loader?: (auth, provider) => Promise<Record<string, any>>
}
```

### Auth Types

```typescript
// OAuth credentials
{ type: "oauth", refresh: string, access: string, expires: number }

// API key
{ type: "api", key: string }

// Well-known provider
{ type: "wellknown", key: string, token: string }
```

### Credential Storage

**File Location**: `~/.opencode/auth.json` (via `Global.Path.data`)

**Format**:
```json
{
  "anthropic": {
    "type": "oauth",
    "refresh": "...",
    "access": "...",
    "expires": 1764258797353
  },
  "opencode": {
    "type": "api",
    "key": "..."
  }
}
```

### OAuth Flow (via Plugins)

1. **Auto method**: Plugin opens browser, starts local server, waits for callback
2. **Code method**: Plugin shows URL, user pastes authorization code

### Provider Priority

1. opencode (recommended)
2. anthropic (recommended)
3. github-copilot
4. openai
5. google
6. openrouter
7. vercel

---

## Credential Storage Locations

### Summary Table

| CLI Tool | Primary Location | Alternative | File Permissions |
|----------|-----------------|-------------|------------------|
| Qwen Code | `~/.qwen/oauth_creds.json` | Keychain `qwen-code-oauth` | 0o600 |
| Claude Code | macOS Keychain | `~/.claude/` | Varies |
| Gemini CLI | `~/.gemini/oauth_creds.json` | `GOOGLE_APPLICATION_CREDENTIALS` | 0o600 |
| OpenCode | `~/.opencode/auth.json` | N/A | 0o600 |

### Compatibility Strategy

To be compatible with Qwen Code CLI:
1. **Check first**: `~/.qwen/oauth_creds.json`
2. **Fallback**: `~/.agent/qwen/oauth_creds.json` (our app folder)

---

## Implementation Proposal for @link-assistant/agent

### Option 1: Full Qwen OAuth Implementation (Recommended)

Implement the complete Device Code OAuth flow to provide the same login experience as Qwen Code CLI.

**Pros**:
- Full feature parity with Qwen Code CLI
- Seamless user experience
- Automatic credential sharing with Qwen Code CLI

**Cons**:
- More complex implementation
- Requires handling token refresh

**Implementation Steps**:

1. **Add OAuth module** (`src/auth/qwen-oauth.ts`):
   ```typescript
   export namespace QwenOAuth {
     const QWEN_CLIENT_ID = "f0304373b74a44d2b584a3fb70ca9e56"
     const QWEN_BASE_URL = "https://chat.qwen.ai"
     const QWEN_DEVICE_CODE_ENDPOINT = "/api/v1/oauth2/device/code"
     const QWEN_TOKEN_ENDPOINT = "/api/v1/oauth2/token"

     export async function initiateDeviceFlow(): Promise<DeviceCodeResponse>
     export async function pollForToken(deviceCode: string): Promise<TokenResponse>
     export async function refreshToken(refreshToken: string): Promise<TokenResponse>
   }
   ```

2. **Add credential storage** (`src/auth/qwen-storage.ts`):
   ```typescript
   export namespace QwenStorage {
     // Check ~/.qwen/oauth_creds.json first (Qwen Code CLI compatibility)
     // Fallback to ~/.agent/qwen/oauth_creds.json
     export async function loadCredentials(): Promise<QwenCredentials | null>
     export async function saveCredentials(creds: QwenCredentials): Promise<void>
   }
   ```

3. **Add CLI command** (`src/cli/cmd/qwen-auth.ts`):
   ```typescript
   export const QwenAuthCommand = {
     command: "qwen:login",
     describe: "Login with Qwen OAuth",
     async handler() {
       // 1. Check for existing valid credentials
       // 2. Initiate device code flow
       // 3. Show user code and verification URL
       // 4. Poll for token
       // 5. Save credentials
     }
   }
   ```

4. **Integrate with provider system**:
   - Add Qwen provider to detect OAuth credentials
   - Use access token for API calls when available
   - Fallback to `OPENAI_API_KEY` for non-interactive use

### Option 2: Credential Reading Only (Minimal)

Only read existing Qwen Code CLI credentials without implementing the full OAuth flow.

**Pros**:
- Minimal implementation effort
- No OAuth complexity
- Users can use `qwen` CLI for login

**Cons**:
- Requires Qwen Code CLI to be installed
- Less convenient user experience
- Cannot refresh expired tokens

**Implementation**:
```typescript
export async function getQwenCredentials(): Promise<string | null> {
  const qwenPath = path.join(os.homedir(), '.qwen', 'oauth_creds.json')
  try {
    const creds = JSON.parse(await fs.readFile(qwenPath, 'utf-8'))
    if (creds.expiry_date > Date.now()) {
      return creds.access_token
    }
    // Token expired, user needs to re-run qwen CLI
    return null
  } catch {
    return null
  }
}
```

### Option 3: OpenCode Plugin Style (Most Flexible)

Implement as a plugin following OpenCode's pattern.

**Pros**:
- Consistent with OpenCode architecture
- Can be shared as npm package
- Supports multiple auth methods

**Cons**:
- Requires plugin system implementation
- More architecture work

**Implementation**:

Create `@link-assistant/qwen-auth` plugin:
```typescript
export const QwenAuthPlugin: Plugin = async (input) => ({
  auth: {
    provider: "qwen",
    methods: [
      {
        type: "oauth",
        label: "Qwen OAuth",
        async authorize() {
          // Device code flow implementation
        }
      },
      {
        type: "api",
        label: "API Key",
        prompts: [
          { type: "text", key: "apiKey", message: "Enter your Qwen API key" }
        ]
      }
    ]
  }
})
```

### Recommended Implementation: Hybrid Approach

**Phase 1 (Immediate)**:
1. Implement credential reading from `~/.qwen/oauth_creds.json`
2. Add `QWEN_ACCESS_TOKEN` environment variable support
3. Document how to use existing Qwen Code CLI for login

**Phase 2 (Full Implementation)**:
1. Implement Device Code OAuth flow
2. Add `agent qwen:login` command
3. Support credential storage in `~/.agent/qwen/`
4. Implement token refresh logic

**Phase 3 (Advanced)**:
1. Consider plugin architecture for extensibility
2. Add keychain storage option
3. Support enterprise Qwen deployments

### CLI Integration Example

```bash
# Phase 1: Use existing Qwen Code CLI credentials
qwen  # User logs in via Qwen Code CLI
echo "hi" | agent --model opencode/qwen3-coder-480b

# Phase 2: Native login support
agent qwen:login
echo "hi" | agent --model qwen/qwen3-coder-480b

# API Key fallback (all phases)
QWEN_API_KEY="..." echo "hi" | agent --model qwen/qwen3-coder-480b
```

---

## References

### Official Documentation

- [Qwen Code Authentication Setup](https://qwenlm.github.io/qwen-code-docs/en/cli/authentication/)
- [Qwen Code GitHub Repository](https://github.com/QwenLM/qwen-code)
- [Claude Code IAM Documentation](https://code.claude.com/docs/en/iam)
- [Gemini CLI GitHub Repository](https://github.com/google-gemini/gemini-cli)
- [OpenCode Providers Documentation](https://opencode.ai/docs/providers/)

### Source Code References

- Qwen OAuth2: `packages/core/src/qwen/qwenOAuth2.ts` (QwenLM/qwen-code)
- Qwen Credential Storage: `packages/core/src/code_assist/oauth-credential-storage.ts` (QwenLM/qwen-code)
- Gemini OAuth2: `packages/core/src/code_assist/oauth2.ts` (google-gemini/gemini-cli)
- OpenCode Auth: `packages/opencode/src/auth/index.ts` (sst/opencode)
- OpenCode Anthropic Auth: `index.mjs` (sst/opencode-anthropic-auth)

### Related Issues and Discussions

- [Qwen.ai OAuth Support Request (OpenCode)](https://github.com/sst/opencode/issues/1726)
- [OpenCode with Claude OAuth Tokens](https://github.com/sst/opencode/issues/417)
- [Anthropic OAuth Credentials (OpenCode)](https://github.com/sst/opencode/issues/1461)

---

*Document created: December 2025*
*For: Issue #24 - Qwen Coder OAuth support*
