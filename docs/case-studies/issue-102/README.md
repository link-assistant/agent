# Case Study: Issue #102 - Google Gemini 3 Pro Internal Error

## Summary

**Issue:** [#102 - google/gemini-3-pro: `Failed after 3 attempts. Last error: Internal error encountered.`](https://github.com/link-assistant/agent/issues/102)

**Date:** December 24, 2025
**Version:** 0.7.0
**Reporter:** @konard
**Status:** Under Investigation

When users attempt to use the `google/gemini-3-pro` model, the agent fails with a 500 Internal Server Error from Google's Cloud Code API after 3 retry attempts.

---

## Table of Contents

1. [Timeline of Events](#timeline-of-events)
2. [Technical Analysis](#technical-analysis)
3. [Root Cause Analysis](#root-cause-analysis)
4. [Proposed Solutions](#proposed-solutions)
5. [References](#references)

---

## Timeline of Events

Based on analysis of the verbose log (`verbose-log.txt`), here is the reconstructed sequence of events:

### Event Sequence (2025-12-24T15:53:10Z - 15:53:28Z)

| Timestamp     | Event             | Details                                                                    |
| ------------- | ----------------- | -------------------------------------------------------------------------- |
| 15:53:10.446Z | Agent Started     | Version 0.7.0, model: `google/gemini-3-pro`                                |
| 15:53:10.521Z | Session Created   | Session ID: `ses_4aeef8f86ffejyBcZwhU8uQtwq`                               |
| 15:53:10.664Z | OAuth Init        | Google OAuth credentials detected                                          |
| 15:53:10.668Z | Cloud Code Init   | Endpoint: `https://cloudcode-pa.googleapis.com`, API: `v1internal`         |
| 15:53:10.672Z | Model Lookup      | `gemini-3-pro` found, mapped to `gemini-3-pro-preview`                     |
| 15:53:10.901Z | Token Refresh     | Access token expiring soon (208s remaining), refresh initiated             |
| 15:53:11.015Z | Token Refreshed   | New token obtained, expires in 3599s                                       |
| 15:53:11.063Z | API Request #1    | Request to `gemini-3-pro-preview:streamGenerateContent` via Cloud Code API |
| 15:53:22.307Z | **Error #1**      | Cloud Code API returned 500 Internal Server Error                          |
| 15:53:24.360Z | API Request #2    | Retry attempt #2                                                           |
| 15:53:24.362Z | **Error #2**      | Cloud Code API returned 500 Internal Server Error                          |
| 15:53:28.394Z | API Request #3    | Retry attempt #3                                                           |
| 15:53:28.398Z | **Error #3**      | Cloud Code API returned 500 Internal Server Error                          |
| 15:53:28.398Z | **Final Failure** | `AI_RetryError: Failed after 3 attempts`                                   |

### Total Duration: ~18 seconds

---

## Technical Analysis

### Authentication Flow

The agent uses a two-tier authentication system for Google Gemini models:

1. **Primary Route (OAuth):** Uses Google OAuth tokens to route requests through the Cloud Code API (`cloudcode-pa.googleapis.com`)
2. **Fallback Route (API Key):** Falls back to direct API calls using `GOOGLE_GENERATIVE_AI_API_KEY` or `GEMINI_API_KEY` environment variables

### Model Mapping

The codebase maps user-friendly model names to actual API model IDs:

```
User Input:     google/gemini-3-pro
Mapped To:      gemini-3-pro-preview
API Model ID:   gemini-3-pro-preview
```

This mapping is defined in `src/provider/provider.ts:604-614`.

### URL Transformation

The Cloud Code API routing transforms URLs as follows:

```
Original:  https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:streamGenerateContent
Routed To: https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent
```

### Request Body Transformation

The request body is wrapped for Cloud Code API compatibility:

```json
// Standard format (input)
{
  "contents": [...],
  "generationConfig": {...}
}

// Cloud Code format (transformed)
{
  "model": "gemini-3-pro-preview",
  "request": {
    "contents": [...],
    "generationConfig": {...}
  }
}
```

### Error Response

The Cloud Code API returned a consistent error across all 3 attempts:

```json
{
  "error": {
    "code": 500,
    "message": "Internal error encountered.",
    "status": "INTERNAL"
  }
}
```

---

## Root Cause Analysis

### Possible Causes (Ordered by Likelihood)

#### 1. **Cloud Code API Service Issues (Most Likely)**

Evidence:

- The 500 Internal Error is a server-side error from Google
- Multiple users have reported similar issues with `cloudcode-pa.googleapis.com` (see [gemini-cli#8412](https://github.com/google-gemini/gemini-cli/issues/8412), [gemini-cli#7562](https://github.com/google-gemini/gemini-cli/issues/7562))
- This endpoint appears to have intermittent stability issues

Known Issues:

- [API Error: countTokens failed, reason: write ERANGE](https://github.com/google-gemini/gemini-cli/issues/8412)
- [API Error: countTokens failed, reason: (empty)](https://github.com/google-gemini/gemini-cli/issues/7562)
- [API Error: ECONNRESET](https://github.com/google-gemini/gemini-cli/issues/5551)

#### 2. **Gemini 3 Pro Preview Model Issues**

Evidence:

- Gemini 3 Pro is currently in "preview" status (`gemini-3-pro-preview`)
- According to Google's documentation, "Rate limits are more restricted for experimental and preview models"
- The model was recently released (December 2025) and may have capacity constraints

Key Facts:

- Gemini 3 Pro Preview is only available on global endpoints
- There is no free tier for `gemini-3-pro-preview` in the Gemini API (only `gemini-3-flash-preview` has a free tier)
- Access requires Google AI Ultra subscription or paid Gemini API key

#### 3. **Rate Limiting or Capacity Issues**

Evidence:

- The 500 error can sometimes mask rate limiting issues
- Forum reports indicate users experienced progression from 429 → 500 errors
- The Cloud Code API may have stricter limits than the direct API

#### 4. **OAuth Token or Permission Issues**

Evidence (against this cause):

- Token was successfully refreshed with 3599s validity
- Authentication appears to work (OAuth credentials were accepted)
- The error is clearly an INTERNAL error, not authentication-related

### Why the Fallback Didn't Work

The agent logged:

```
"no fallback api key available"
"hint": "Set GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY environment variable for fallback"
```

The user did not have an API key configured as a fallback, so when the Cloud Code API failed, there was no alternative route.

---

## Proposed Solutions

### Immediate Workarounds

#### Option 1: Set Fallback API Key

Configure a direct API key as fallback:

```bash
export GOOGLE_GENERATIVE_AI_API_KEY="your-api-key"
# OR
export GEMINI_API_KEY="your-api-key"
```

This allows the agent to fall back to direct API calls when Cloud Code API fails.

#### Option 2: Use Alternative Model

Try using `gemini-3-flash-preview` which may have better availability:

```bash
echo "hi" | agent --model google/gemini-3-flash-preview
```

Or use a non-preview model:

```bash
echo "hi" | agent --model google/gemini-2.5-flash
```

### Long-term Code Improvements

#### 1. Enhanced Error Handling

Improve error messages to provide actionable guidance:

```typescript
// In src/auth/plugins.ts, around line 1780
if (!cloudCodeResponse.ok) {
  const errorBody = await cloudCodeResponse
    .clone()
    .text()
    .catch(() => 'unknown');

  log.error(() => ({
    message: 'cloud code api error',
    status: cloudCodeResponse.status,
    hint:
      cloudCodeResponse.status === 500
        ? 'This is a server-side error from Google. Try: (1) Wait and retry, (2) Set GEMINI_API_KEY for fallback, (3) Use a different model like gemini-3-flash-preview'
        : 'Set GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY environment variable for fallback',
  }));

  // ... existing fallback logic
}
```

#### 2. Automatic Model Fallback

Add option to automatically fall back to a similar model on failure:

```typescript
const modelFallbacks: Record<string, string[]> = {
  'gemini-3-pro-preview': ['gemini-3-flash-preview', 'gemini-2.5-pro'],
  'gemini-3-flash-preview': ['gemini-2.5-flash'],
};
```

#### 3. Retry Strategy Improvements

Implement more sophisticated retry logic:

```typescript
// Current: 3 retries with basic exponential backoff
// Proposed: Add jitter and longer delays for 500 errors
const retryConfig = {
  maxRetries: 5,
  baseDelay: 1000,
  maxDelay: 30000,
  jitter: true,
  // For 500 errors, wait longer as they often indicate temporary overload
  serverErrorMultiplier: 2,
};
```

#### 4. Health Check Endpoint

Add a health check before attempting API calls:

```typescript
async function checkCloudCodeHealth(): Promise<boolean> {
  try {
    const response = await fetch(
      'https://cloudcode-pa.googleapis.com/v1internal:healthCheck',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(5000),
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}
```

#### 5. Documentation Update

Add to README or MODELS.md:

```markdown
## Known Issues

### Gemini 3 Pro Preview

The `gemini-3-pro-preview` model routes through Google's Cloud Code API which may
experience intermittent availability issues.

**Recommended Configuration:**

1. Set a fallback API key: `export GEMINI_API_KEY="your-key"`
2. For production use, consider `gemini-3-flash-preview` which has better availability
3. Monitor [Google Cloud Status](https://status.cloud.google.com/) for outages
```

---

## References

### Official Documentation

- [Gemini API Troubleshooting Guide](https://ai.google.dev/gemini-api/docs/troubleshooting)
- [Gemini API Rate Limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Gemini 3 Pro Documentation](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-pro)
- [Gemini 3 Developer Guide](https://ai.google.dev/gemini-api/docs/gemini-3)

### Related Issues

- [gemini-cli#8412: countTokens failed, reason: write ERANGE](https://github.com/google-gemini/gemini-cli/issues/8412)
- [gemini-cli#7562: countTokens failed, reason: (empty)](https://github.com/google-gemini/gemini-cli/issues/7562)
- [gemini-cli#5551: ECONNRESET](https://github.com/google-gemini/gemini-cli/issues/5551)
- [Forum: 500 Internal Server Error](https://discuss.ai.google.dev/t/500-internal-server-error-while-trying-with-api/100240)

### News & Announcements

- [Google Launches Gemini 3 Flash (TechCrunch)](https://techcrunch.com/2025/12/17/google-launches-gemini-3-flash-makes-it-the-default-model-in-the-gemini-app/)
- [Gemini 3 Blog Post](https://blog.google/products/gemini/gemini-3/)
- [Gemini 3 for Enterprise](https://cloud.google.com/blog/products/ai-machine-learning/gemini-3-is-available-for-enterprise)

### Code References

- Model mapping: `src/provider/provider.ts:604-614`
- Cloud Code routing: `src/auth/plugins.ts:1354-1396`
- Error handling: `src/auth/plugins.ts:1743-1791`
- Temperature setting: `src/provider/transform.ts:153`

---

## Appendix

### Files in This Case Study

- `README.md` - This document
- `verbose-log.txt` - Full verbose log from user's session

### Diagnostic Commands

```bash
# Check if the Cloud Code API is accessible
curl -s "https://cloudcode-pa.googleapis.com/v1internal" -H "Authorization: Bearer $(gcloud auth print-access-token)"

# Test with direct API (bypassing Cloud Code)
curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent" \
  -H "Content-Type: application/json" \
  -H "x-goog-api-key: YOUR_API_KEY" \
  -d '{"contents":[{"parts":[{"text":"hi"}]}]}'

# Check current model availability
curl -s "https://generativelanguage.googleapis.com/v1beta/models" \
  -H "x-goog-api-key: YOUR_API_KEY" | jq '.models[] | select(.name | contains("gemini-3"))'
```
