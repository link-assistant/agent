# Case Study: Issue #100 - Google OAuth Scope Mismatch

## Issue Reference

- **Issue URL**: https://github.com/link-assistant/agent/issues/100
- **Title**: We should try all available auth credentials we have for Google
- **Labels**: bug
- **Date Reported**: December 23, 2025

## Timeline of Events

1. **User installs agent v0.6.3**: `bun install -g @link-assistant/agent@latest`
2. **User authenticates with Google OAuth**: Uses "Google AI Pro/Ultra (OAuth - Manual Code Entry)" method
3. **Login appears successful**: Terminal shows "Login successful"
4. **API request fails**: When using `echo "hi" | agent --model google/gemini-3-pro`, the request fails with error code 403

## Error Analysis

### Error Response Details

```json
{
  "error": {
    "code": 403,
    "message": "Request had insufficient authentication scopes.",
    "status": "PERMISSION_DENIED",
    "details": [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        "reason": "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
        "domain": "googleapis.com",
        "metadata": {
          "method": "google.ai.generativelanguage.v1beta.GenerativeService.StreamGenerateContent",
          "service": "generativelanguage.googleapis.com"
        }
      }
    ]
  }
}
```

### WWW-Authenticate Header

```
Bearer realm="https://accounts.google.com/",
error="insufficient_scope",
scope="https://www.googleapis.com/auth/generative-language
       https://www.googleapis.com/auth/generative-language.tuning
       https://www.googleapis.com/auth/generative-language.tuning.readonly
       https://www.googleapis.com/auth/generative-language.retriever
       https://www.googleapis.com/auth/generative-language.retriever.readonly"
```

## Root Cause Analysis

### Current Implementation (src/auth/plugins.ts)

The Google OAuth plugin uses these scopes:

```typescript
const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];
```

### What Our API Requires

We make API calls to `generativelanguage.googleapis.com` which requires specific scopes:

- `https://www.googleapis.com/auth/generative-language`
- `https://www.googleapis.com/auth/generative-language.tuning`
- `https://www.googleapis.com/auth/generative-language.retriever`

### The Real Difference: API Endpoint

**Our Implementation**:

- Uses `generativelanguage.googleapis.com` (standard Generative Language API)
- This API requires `generative-language.*` scopes
- OAuth client doesn't have these scopes registered → **SCOPE MISMATCH**

**Gemini CLI Implementation**:

- Uses `https://cloudcode-pa.googleapis.com/v1internal` (Cloud Code API)
- This is a **different API endpoint** that wraps the Generative Language API
- The Cloud Code API accepts `cloud-platform` scope!
- Same OAuth client, same scopes, but **different API that works with those scopes**

### Gemini CLI Architecture (Key Discovery)

```
User OAuth (cloud-platform scope)
    ↓
Gemini CLI → Cloud Code API (cloudcode-pa.googleapis.com/v1internal)
    ↓
Cloud Code Server → Generative Language API (internal)
```

The Gemini CLI doesn't call `generativelanguage.googleapis.com` directly. It calls Google's **Cloud Code API** which:

1. Accepts `cloud-platform` OAuth tokens
2. Handles subscription validation (FREE tier, STANDARD tier)
3. Proxies requests to the Generative Language API internally

### Code Evidence from Gemini CLI

From `/tmp/gemini-cli/packages/core/src/code_assist/server.ts`:

```typescript
export const CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com';
export const CODE_ASSIST_API_VERSION = 'v1internal';

export class CodeAssistServer implements ContentGenerator {
  // Makes requests to cloudcode-pa.googleapis.com, not generativelanguage.googleapis.com
  async generateContentStream(req, userPromptId) {
    return this.requestStreamingPost('streamGenerateContent', ...);
  }

  getMethodUrl(method: string): string {
    return `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:${method}`;
  }
}
```

## Key Findings

### Authentication Methods for Google AI

| Method                      | Required Scope                      | Works?       |
| --------------------------- | ----------------------------------- | ------------ |
| API Key                     | None (uses `x-goog-api-key` header) | Yes          |
| OAuth (cloud-platform)      | `cloud-platform`                    | Inconsistent |
| OAuth (generative-language) | `generative-language.*`             | Should work  |

### The Issue Title's Insight

The issue title "We should try all available auth credentials we have for Google" suggests that:

1. Users may have both OAuth tokens and API keys stored
2. When OAuth fails due to scope issues, the system should fall back to API key authentication
3. Currently, the system does not attempt alternative credentials

## Current Auth Storage

From `src/auth/index.ts`:

```typescript
export namespace Auth {
  export const Oauth = z.object({
    type: z.literal('oauth'),
    refresh: z.string(),
    access: z.string(),
    expires: z.number(),
    enterpriseUrl: z.string().optional(),
  });

  export const Api = z.object({
    type: z.literal('api'),
    key: z.string(),
  });

  // Auth is stored per-provider in auth.json
}
```

Auth credentials are stored by provider ID, meaning:

- `google` -> OAuth credentials (with limited scope)
- API keys from environment variables (`GOOGLE_GENERATIVE_AI_API_KEY` or `GEMINI_API_KEY`)

## Proposed Solutions

### Solution 1: Use Cloud Code API (Recommended - Matches Gemini CLI)

**The proper fix**: Use the same API endpoint as Gemini CLI.

When Google OAuth is active, route API calls through:

- `https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent`

Instead of:

- `https://generativelanguage.googleapis.com/v1beta/models/...:streamGenerateContent`

**Pros**:

- Exact same approach as official Gemini CLI
- Works with existing `cloud-platform` scope
- Supports subscription tiers (FREE, STANDARD, etc.)
- No need for users to set API keys

**Cons**:

- Requires implementing Cloud Code API request/response translation
- More complex implementation

### Solution 2: Add Generative Language Scopes to OAuth

Update `GOOGLE_OAUTH_SCOPES` in `src/auth/plugins.ts`:

```typescript
const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/generative-language',
];
```

**Pros**: Simple fix
**Cons**:

- Won't work - scopes aren't registered for the OAuth client (causes `403: restricted_client`)
- See issue #93

### Solution 3: Credential Fallback Mechanism (Current Implementation)

Implement a fallback strategy in `src/auth/plugins.ts`:

1. Try OAuth credentials first
2. If OAuth fails with scope error (403), try API key
3. If API key fails, report the original error

**Pros**: Works as workaround
**Cons**:

- Requires users to have an API key set
- Doesn't leverage subscription benefits properly
- Not the same experience as Gemini CLI

## Implementation Recommendation

**Proper Fix**: Solution 1 - Use Cloud Code API

This requires implementing a `CodeAssistServer`-like client that:

1. Calls `https://cloudcode-pa.googleapis.com/v1internal` endpoints
2. Translates between our request format and Cloud Code API format
3. Uses the `google-auth-library` OAuth client for Bearer token authentication

The Gemini CLI has already implemented this in:

- `/packages/core/src/code_assist/server.ts` - API client
- `/packages/core/src/code_assist/converter.ts` - Request/response translation

**Temporary Fix**: Solution 3 - Credential Fallback (Already Implemented)

Until Solution 1 is implemented, users can set an API key as a fallback.

## Implementation

### Changes Made

#### Key Insight: OAuth Client Scope Limitations

The generative-language scopes cannot simply be added to the OAuth flow because:

1. The Gemini CLI OAuth client (`681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j`) only has certain scopes registered
2. Attempting to request unregistered scopes causes a `403: restricted_client` error (see issue #93)
3. Therefore, the solution is NOT to add more scopes, but to fall back to API key authentication

#### Implemented Solution: Fallback to API Key on OAuth Scope Errors (`src/auth/plugins.ts`)

In the Google OAuth loader, added logic to:

1. Detect OAuth scope errors (HTTP 403 with `insufficient_scope` in `www-authenticate` header)
2. Fall back to API key authentication if available (`GOOGLE_GENERATIVE_AI_API_KEY` or `GEMINI_API_KEY`)
3. Log helpful warnings and hints for users

```typescript
const isScopeError = (response: Response): boolean => {
  if (response.status !== 403) return false;
  const wwwAuth = response.headers.get('www-authenticate') || '';
  return (
    wwwAuth.includes('insufficient_scope') ||
    wwwAuth.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT')
  );
};

// In the fetch handler:
if (isScopeError(oauthResponse)) {
  const fallbackApiKey = getFallbackApiKey();
  if (fallbackApiKey) {
    log.warn('oauth scope error, falling back to api key authentication');
    // Use API key instead of OAuth
  }
}
```

### How to Test

1. **Users with OAuth + API key**: Set `GOOGLE_GENERATIVE_AI_API_KEY` or `GEMINI_API_KEY` environment variable. When OAuth fails with scope error, it will automatically fall back to the API key.

2. **Manual verification**: Check the logs for messages like:
   - `using google oauth credentials` - OAuth being used
   - `oauth scope error, falling back to api key authentication` - Fallback triggered
   - `oauth scope error and no api key fallback available` - No fallback available (user needs to set API key)

## References

- [Google OAuth Scopes Documentation](https://ai.google.dev/gemini-api/docs/oauth)
- [Gemini CLI OAuth Implementation](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/oauth2.ts)
- [Issue #51 - PaLM API 403 Insufficient Scopes](https://github.com/google/generative-ai-python/issues/51)
- [Google Developer Forum - ACCESS_TOKEN_SCOPE_INSUFFICIENT](https://discuss.google.dev/t/googlegenerativeaierror-access-token-scope-insufficient/170693)
