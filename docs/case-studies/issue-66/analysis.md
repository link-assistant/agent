# Case Study: Issue #66 - Full support for Gemini OAuth (subscriptions login)

## Issue Summary

- **Title**: Full support for Gemini OAuth (subscriptions login)
- **Opened**: December 16, 2025
- **Closed**: With PRs #67 and #74
- **Description**: Currently only API token support for Gemini, need OAuth support for subscriptions like Claude Pro/Max

## Timeline Reconstruction

1. **December 16, 2025**: Issue opened with description and screenshot showing lack of OAuth support
2. **Subsequent days**: PR #67 and #74 created to implement Google OAuth authentication
3. **Issue closed**: After implementation completed

## Root Cause Analysis

### Primary Cause

The agent CLI only supported API key authentication for Google/Gemini providers, but Google AI Pro/Premium subscriptions require OAuth 2.0 authentication for access to the Gemini API.

### Contributing Factors

- Google AI API supports both API keys (free tier) and OAuth (paid subscriptions)
- Claude already had OAuth support for Pro/Max subscriptions
- Reference implementation existed in Gemini CLI with working OAuth flow
- Agent used same OAuth client ID as Gemini CLI but lacked the authentication flow

### Technical Details

- Google AI API endpoint: generativelanguage.googleapis.com
- OAuth client ID: 681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com (public for installed apps)
- Required scopes: cloud-platform, userinfo.email, userinfo.profile
- Authentication flow: OAuth 2.0 with PKCE, local server callback

## Solution Implemented

### OAuth Plugin Addition

- Added Google OAuth authentication plugin in `src/auth/plugins.ts`
- Supports both web browser flow and manual code entry
- Uses same client credentials as official Gemini CLI
- Stores tokens securely in `~/.local/share/agent/auth.json`

### Provider Integration

- Updated `google` provider to support OAuth tokens
- Falls back to API keys if no OAuth credentials
- Added `google-oauth` provider for OAuth-only usage
- Custom fetch function adds Bearer token for authenticated requests

### Key Changes

- Removed extra scope `generative-language.retriever` to match reference implementation
- Implemented token refresh logic
- Added zero-cost billing for subscription users

## Additional Research Findings

### Google Documentation

- Gemini API supports OAuth for Pro/Premium subscriptions: https://ai.google.dev/gemini-api/docs/oauth
- OAuth 2.0 scopes: https://developers.google.com/identity/protocols/oauth2/scopes
- Client secret is intentionally public for installed applications

### Related Issues

- Gemini CLI issue #10110: Authentication fails for Google AI Pro accounts
- Support thread: Using existing Gemini Pro subscription for integration

### Implementation References

- Gemini CLI OAuth implementation in `packages/core/src/code_assist/oauth2.ts`
- Claude OAuth implementation in `src/auth/claude-oauth.ts`
- OpenCode auth plugins

## Impact Assessment

### User Impact

- Gemini Pro/Premium subscribers can now authenticate via OAuth
- Eliminates need for separate API key management
- Consistent experience with Claude Pro/Max authentication

### Technical Impact

- Added OAuth support without breaking existing API key users
- Secure token storage with automatic refresh
- Reused existing provider architecture

## Lessons Learned

1. **Consistency**: Maintain authentication parity across providers
2. **Reference Code**: Leverage official CLI implementations for auth flows
3. **Scopes**: Use minimal required scopes to avoid permission issues
4. **Fallback**: Support both OAuth and API key for flexibility
5. **Security**: Use established OAuth libraries and secure storage

## Recommendations

1. **Testing**: Add integration tests for OAuth flows
2. **Documentation**: Update auth guide with Gemini OAuth instructions
3. **Monitoring**: Track OAuth success/failure rates
4. **User Education**: Highlight subscription benefits in auth prompts
5. **Future**: Consider unified auth experience across all providers
