# Case Study: Issue #66 - Full support for Gemini OAuth (subscriptions login)

## Issue Summary

The issue requests full support for Gemini OAuth authentication to enable subscriptions login, similar to the existing Claude Pro/Max OAuth support. Currently, the agent only supports API token authentication for Gemini.

## Timeline of Events

- **December 16, 2025**: Issue #66 opened requesting Gemini OAuth support
- **Analysis**: The codebase already contains Google OAuth implementation in `src/auth/plugins.ts`, but the scopes were insufficient for Gemini API subscriptions

## Root Cause Analysis

1. **Insufficient OAuth Scopes**: The Google OAuth plugin only included basic scopes (`cloud-platform`, `userinfo.email`, `userinfo.profile`) but lacked the `generative-language.tuning` and `generative-language.retriever` scopes required for Gemini API subscription features.

2. **Scope Mismatch**: While the implementation was present, the scopes didn't match those recommended in the official Gemini API OAuth documentation for advanced features and subscriptions.

3. **Client Credentials**: The client ID and secret were sourced from the Gemini CLI reference, which may not be optimal for API usage, but appear to be compatible.

## Proposed Solution

Updated the `GOOGLE_OAUTH_SCOPES` array in `src/auth/plugins.ts` to include the additional generative-language scopes required for Gemini API subscriptions.

### Code Changes

```typescript
const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/generative-language.tuning',
  'https://www.googleapis.com/auth/generative-language.retriever',
];
```

## Implementation Details

- The Google OAuth plugin already supports the full OAuth flow with local server callback
- The provider logic correctly detects OAuth credentials and uses Bearer token authentication
- The implementation follows the same pattern as Anthropic OAuth support

## Testing Recommendations

1. Test OAuth login flow: `agent auth login` → select Google → complete OAuth flow
2. Verify that Gemini models work with OAuth credentials
3. Confirm that subscription benefits (higher limits, premium features) are accessible
4. Test fallback to API key when OAuth is not configured

## References

- Reference implementation: `reference-gemini-cli/packages/core/src/code_assist/oauth2.ts`
- Gemini API OAuth documentation: https://ai.google.dev/gemini-api/docs/oauth
- Current agent OAuth: `src/auth/plugins.ts` GooglePlugin
