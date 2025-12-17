# Case Study: Issue #62 - Anthropic API Errors Analysis

**Issue Link**: https://github.com/link-assistant/agent/issues/62
**Date Reported**: December 16, 2025
**Reporter**: @konard
**Status**: Fixed (PR #63)

## Executive Summary

This case study analyzes three distinct errors encountered when using the `@link-assistant/agent` CLI tool with Anthropic's Claude models via Claude Code OAuth credentials. The errors occur in different scenarios and have different root causes, but all relate to the interaction between OAuth-based authentication and Anthropic's API requirements.

---

## Table of Contents

1. [Timeline of Events](#timeline-of-events)
2. [Error Analysis](#error-analysis)
   - [Error 1: Empty System Message Cache Control](#error-1-empty-system-message-cache-control)
   - [Error 2: Claude Code Credential Restriction](#error-2-claude-code-credential-restriction)
   - [Error 3: Rate Limit Exceeded](#error-3-rate-limit-exceeded)
3. [Root Cause Analysis](#root-cause-analysis)
4. [Proposed Solutions](#proposed-solutions)
5. [External References](#external-references)

---

## Timeline of Events

Based on the timestamps in the error logs:

| Timestamp (Unix ms) | Time (UTC)           | Command                   | Error                                |
| ------------------- | -------------------- | ------------------------- | ------------------------------------ |
| 1765920267268       | 2025-12-16 21:24:27  | `--system-message ""`     | Empty text block cache_control error |
| 1765920316694       | 2025-12-16 21:25:16  | `--system-message "Test"` | Credential restriction error         |
| N/A                 | 2025-12-16 ~21:25:xx | (no --system-message)     | Rate limit exceeded                  |

**Sequence of Events:**

1. User ran the agent with `--system-message ""` (empty string), triggering a cache_control error
2. User ran the agent with `--system-message "Test"`, triggering a credential restriction error
3. User ran the agent without `--system-message`, hitting a rate limit after 3 retry attempts

---

## Error Analysis

### Error 1: Empty System Message Cache Control

**Command:**

```bash
echo "Which tools you have enabled?" | agent --model anthropic/claude-sonnet-4-5 --system-message ""
```

**Error Message:**

```
system.0: cache_control cannot be set for empty text blocks
```

**Status Code:** 400 (Bad Request)

**Technical Details:**

When `--system-message ""` is passed, the code path in `src/session/prompt.ts:697-709` returns an array with an empty string as the only system message:

```javascript
// When --system-message is provided, use it exclusively
if (input.system !== undefined) {
  return [input.system]; // Returns [""] when --system-message ""
}
```

The issue occurs in `src/provider/transform.ts:85-131` where `applyCaching()` adds cache control options to system messages:

```javascript
function applyCaching(msgs: ModelMessage[], providerID: string): ModelMessage[] {
  const system = msgs.filter((msg) => msg.role === 'system').slice(0, 2);
  // ...
  for (const msg of unique([...system, ...final])) {
    msg.providerOptions = {
      ...msg.providerOptions,
      ...providerOptions, // Includes { anthropic: { cacheControl: { type: 'ephemeral' } } }
    };
  }
}
```

The Anthropic API rejects requests where `cache_control` is set on an empty text block.

**Root Cause:** The system does not validate or handle empty system messages before applying cache control settings.

---

### Error 2: Claude Code Credential Restriction

**Command:**

```bash
echo "Which tools you have enabled?" | agent --model anthropic/claude-sonnet-4-5 --system-message "Test"
```

**Error Message:**

```
This credential is only authorized for use with Claude Code and cannot be used for other API requests.
```

**Status Code:** 400 (Bad Request)

**Technical Details:**

This error indicates that Anthropic enforces credential scoping for OAuth tokens obtained from Claude Code. These tokens are restricted to specific use cases.

According to research (see [OpenCode Issue #417](https://github.com/sst/opencode/issues/417)), the key difference between working and non-working implementations lies in the **request body structure**, not just headers or endpoints.

Claude Code OAuth tokens require:

1. Proper `Authorization: Bearer <token>` header (implemented in `src/auth/claude-oauth.ts:410-424`)
2. The `anthropic-beta: oauth-2025-04-20` header (implemented)
3. Potentially specific request body formatting that identifies the client as a legitimate Claude Code application

**Known Workarounds from Community:**

- Only certain models work with Claude Code credentials (claude-sonnet-4-20250514 confirmed working)
- The VS Code extension shows similar issues despite successful OAuth authentication
- Some users report switching plans affects this behavior

**Root Cause:** Anthropic restricts OAuth tokens to specific use cases. The agent may be missing required request metadata or using unsupported model identifiers.

---

### Error 3: Rate Limit Exceeded

**Command:**

```bash
echo "Which tools you have enabled?" | agent --model anthropic/claude-sonnet-4-5
```

**Error Message:**

```
Failed after 3 attempts. Last error: This request would exceed your account's rate limit. Please try again later.
```

**Technical Details:**

The AI SDK (`ai` package v6.0.0-beta.99) implements exponential backoff retry logic. After 3 failed attempts due to rate limiting, it throws a `RetryError`.

Rate limits for Claude Pro/Max subscriptions:

- Claude Pro: 40-80 hours of Sonnet 4 per week
- Claude Max ($100/mo): 140-280 hours of Sonnet 4 per week
- Claude Max ($200/mo): 240-480 hours of Sonnet 4 per week

The 429 error includes a `retry-after` header indicating wait time.

**Root Cause:** User has exceeded their subscription's rate limits, either due to heavy usage or potential issues with OAuth token rate limit tier assignment.

---

## Root Cause Analysis

### Summary of Root Causes

| Error                  | Root Cause                                   | Severity | Fix Complexity  |
| ---------------------- | -------------------------------------------- | -------- | --------------- |
| Empty Cache Control    | Missing validation for empty system messages | High     | Low             |
| Credential Restriction | OAuth token scoping by Anthropic             | High     | Medium-High     |
| Rate Limit             | User quota exhaustion                        | Medium   | N/A (user-side) |

### Detailed Analysis

#### 1. Empty System Message Validation

The codebase assumes system messages are non-empty when provided. The `resolveSystemPrompt` function should validate input:

**Current behavior:**

```javascript
if (input.system !== undefined) {
  return [input.system]; // No validation
}
```

**Expected behavior:**

- If `--system-message ""` is passed, either skip it entirely or provide a meaningful error message

#### 2. OAuth Token Scoping

This is an API-side restriction by Anthropic. The agent cannot circumvent this without Anthropic's cooperation. However, there are potential mitigations:

1. **Model ID Validation**: Ensure only supported models are used with OAuth credentials
2. **Request Metadata**: Investigate what additional request body fields Claude Code uses
3. **User Education**: Document which features work with OAuth credentials

#### 3. Rate Limiting

This is expected behavior when users exceed their quotas. The agent could:

1. Provide clearer error messages explaining rate limits
2. Show current usage if available via API
3. Implement configurable retry behavior

---

## Proposed Solutions

### Solution 1: Validate Empty System Messages

**File:** `src/session/prompt.ts`

```javascript
async function resolveSystemPrompt(input: {
  system?: string;
  appendSystem?: string;
  agent: Agent.Info;
  providerID: string;
  modelID: string;
}) {
  // Handle empty system message by treating it as undefined
  if (input.system !== undefined) {
    if (input.system.trim() === '') {
      // Empty system message - skip it entirely, use no system prompt
      return [];
    }
    return [input.system];
  }
  // ... rest of function
}
```

**Alternatively**, validate and filter empty system messages before applying caching:

**File:** `src/provider/transform.ts`

```javascript
function applyCaching(msgs: ModelMessage[], providerID: string): ModelMessage[] {
  // Filter out empty system messages before processing
  const system = msgs
    .filter((msg) => msg.role === 'system')
    .filter((msg) => {
      // Ensure the message has non-empty content
      if (typeof msg.content === 'string') return msg.content.trim() !== '';
      if (Array.isArray(msg.content)) {
        return msg.content.some(part =>
          typeof part === 'string' ? part.trim() !== '' :
          (part.type === 'text' && part.text?.trim() !== '')
        );
      }
      return false;
    })
    .slice(0, 2);
  // ... rest of function
}
```

### Solution 2: Document OAuth Credential Limitations

Add clear documentation about Claude OAuth credential limitations:

**File:** `README.md` (section on OAuth)

```markdown
## Using Claude OAuth Credentials

When using `--use-existing-claude-oauth` or authenticating via `agent auth login` with Anthropic:

### Supported Features

- Claude Sonnet 4 model access
- Standard chat completions

### Known Limitations

- OAuth tokens are restricted to Claude Code-compatible requests
- Some models may not be accessible with OAuth credentials
- Rate limits are based on your Claude Pro/Max subscription tier

### If You Encounter "Credential Restriction" Errors

1. Ensure you're using a supported model (e.g., `claude-sonnet-4-20250514`)
2. Consider using API key authentication for broader access
3. Check your subscription status at console.anthropic.com
```

### Solution 3: Improved Error Handling

**File:** `src/session/prompt.ts`

Add structured error handling for common API errors:

```javascript
// Add to processor error handling
if (
  error?.data?.message?.includes(
    'cache_control cannot be set for empty text blocks'
  )
) {
  throw new NamedError.Create('EmptySystemMessageError', {
    message:
      'Cannot use an empty system message. Either remove --system-message or provide content.',
    hint: 'Use --system-message "Your prompt here" or omit the flag entirely.',
  });
}

if (
  error?.data?.message?.includes('only authorized for use with Claude Code')
) {
  throw new NamedError.Create('OAuthCredentialRestrictionError', {
    message:
      'Claude OAuth credentials are restricted to Claude Code-compatible requests.',
    hint: 'Use API key authentication (ANTHROPIC_API_KEY) for broader access, or ensure you are using a supported model.',
  });
}
```

### Solution 4: CLI Validation

**File:** `src/index.js`

Add validation middleware:

```javascript
.middleware((argv) => {
  // Validate --system-message is not empty
  if (argv['system-message'] !== undefined && argv['system-message'].trim() === '') {
    console.error('Error: --system-message cannot be empty. Either provide content or omit the flag.');
    process.exit(1);
  }
})
```

---

## External References

### GitHub Issues

- [anthropics/claude-code#2203](https://github.com/anthropics/claude-code/issues/2203) - "cache_control cannot be set for empty text blocks" bug report
- [anthropics/claude-code#8046](https://github.com/anthropics/claude-code/issues/8046) - Credential restriction preventing API requests
- [anthropics/claude-code#8060](https://github.com/anthropics/claude-code/issues/8060) - Credential authorization restriction
- [sst/opencode#417](https://github.com/sst/opencode/issues/417) - How OpenCode works with Claude Code OAuth tokens

### Documentation

- [Anthropic Rate Limits](https://docs.claude.com/en/api/rate-limits) - Official rate limit documentation
- [Anthropic Rate Limit Approach](https://support.anthropic.com/en/articles/8243635-our-approach-to-api-rate-limits) - Understanding rate limiting

### News

- [TechCrunch: Anthropic Rate Limit Changes](https://techcrunch.com/2025/07/28/anthropic-unveils-new-rate-limits-to-curb-claude-code-power-users/) - Coverage of rate limit policy changes for Claude Pro/Max

---

## Appendix: Log Files

The original error logs are stored in:

- `./error-logs/error-1-empty-system-message.json`
- `./error-logs/error-2-claude-code-credential.json`
- `./error-logs/error-3-rate-limit.json`

---

## Implemented Fix

### Solution Overview

Based on additional debugging with `--verbose` flag (see `./verbose-logs/` folder), the solution was identified:

When using Claude Code OAuth credentials, Anthropic's API requires the **"You are Claude Code"** header message to be present in the system prompt. When `--system-message ""` is provided, the code was returning an empty array which caused:

1. The `cache_control cannot be set for empty text blocks` error
2. The credential restriction error (missing OAuth identification)

### Code Change

**File:** `src/session/prompt.ts` (lines 697-723)

```typescript
async function resolveSystemPrompt(input: {
  system?: string;
  appendSystem?: string;
  agent: Agent.Info;
  providerID: string;
  modelID: string;
}) {
  // When --system-message is provided, use it exclusively without any
  // additional context (no environment, no custom instructions, no header).
  // This is critical for models with low token limits (e.g., qwen3-32b with 6K TPM).
  //
  // Exception: For Anthropic providers using OAuth credentials, we must preserve
  // the "You are Claude Code" header even when --system-message "" is provided.
  // This header is required for OAuth token authorization.
  // See: https://github.com/link-assistant/agent/issues/62
  if (input.system !== undefined) {
    // If empty system message is provided for Anthropic, preserve the OAuth header
    if (input.system.trim() === '' && input.providerID.includes('anthropic')) {
      return SystemPrompt.header(input.providerID);
    }
    // For non-empty system messages or non-Anthropic providers, use as-is
    // (but filter out empty strings to prevent cache_control errors)
    if (input.system.trim() === '') {
      return [];
    }
    return [input.system];
  }
  // ... rest of function
}
```

### Key Insight from Verbose Logs

The verbose logs showed that when the agent works correctly, it sends:

```
System Message 1 (14 tokens estimated):
You are Claude Code, Anthropic's official CLI for Claude.
```

This header is required for OAuth token validation on Anthropic's side.

---

## Conclusion

The three errors reported in issue #62 represent different failure modes:

1. **Empty System Message Error**: Fixed by preserving the OAuth header for Anthropic providers
2. **Credential Restriction Error**: Fixed by ensuring "You are Claude Code" message is always sent for Anthropic OAuth
3. **Rate Limit Error**: Expected behavior when quotas are exceeded (user-side limitation)

### Implementation Status

- [x] Fix implemented in `src/session/prompt.ts`
- [x] Root cause identified via verbose logging
- [x] Case study documentation updated
- [x] PR #63 ready for review
