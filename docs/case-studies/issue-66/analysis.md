# Issue #66: Full support for Gemini OAuth (subscriptions login)

## Issue Summary

The issue reports that the agent currently only supports API tokens for Gemini authentication, but needs to support OAuth for Gemini subscriptions like it does for Claude Pro/Max subscriptions.

## Current Implementation Analysis

### Existing Code

The codebase already contains a complete Gemini OAuth implementation:

- `src/auth/gemini-oauth.ts`: Full OAuth 2.0 with PKCE implementation
- `src/auth/plugins.ts`: GooglePlugin that integrates with GeminiOAuth
- `src/provider/provider.ts`: Google provider supports OAuth authentication
- `src/cli/cmd/auth.ts`: Auth command includes Google OAuth option

### OAuth Flow

The implementation provides:

1. PKCE-based authorization URL generation
2. Local HTTP server for callback handling
3. Token exchange and storage
4. Token refresh capability
5. Authenticated fetch wrapper

## Comparison with Reference Implementations

### reference-gemini-cli

- Uses `google-auth-library` OAuth2Client
- Does NOT use PKCE
- Scopes: `cloud-platform`, `userinfo.email`, `userinfo.profile`
- Uses encrypted credential storage
- Client ID/Secret: Same as our implementation

### Our Implementation

- Custom OAuth implementation with fetch
- Uses PKCE
- Scopes: `cloud-platform`, `generative-language.retriever`, `userinfo.email`, `userinfo.profile`
- Plain JSON credential storage
- Same Client ID/Secret

## Root Cause Analysis

### 1. Scope Mismatch

**Issue**: Our implementation includes `generative-language.retriever` scope not present in reference.
**Impact**: May cause authorization failures or unnecessary permission requests.

### 2. PKCE Implementation

**Issue**: Reference implementation doesn't use PKCE, ours does.
**Impact**: PKCE is security best practice but may not be required for this client.

### 3. Storage Security

**Issue**: Reference uses encrypted storage, ours uses plain JSON.
**Impact**: Security concern for stored credentials.

### 4. Library vs Custom Implementation

**Issue**: Reference uses battle-tested google-auth-library, ours uses custom fetch calls.
**Impact**: Potential edge cases not handled in custom implementation.

## Research on OAuth Scopes

### Gemini Cookbook OAuth Example

Scopes used: `cloud-platform`, `generative-language.tuning`, `generative-language.retriever`

### Google AI Documentation

- Basic Gemini API: API keys
- Advanced features (tuning, retrieval): OAuth required
- Subscription access: Likely requires `cloud-platform` scope

### Google OAuth Scopes Documentation

- `cloud-platform`: Full access to Google Cloud services
- `generative-language.*`: Specific to Gemini API features
- `userinfo.*`: User profile information

## Proposed Solutions

### Solution 1: Update Scopes to Match Reference

**Change**: Remove `generative-language.retriever` scope to match reference-gemini-cli.

**Rationale**: Reference implementation works for Gemini CLI subscriptions.

**Implementation**:

```typescript
scopes: [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
],
```

### Solution 2: Remove PKCE

**Change**: Remove PKCE implementation to match reference.

**Rationale**: Reference doesn't use PKCE and works.

**Implementation**: Modify `generateAuthUrl` and `exchangeCode` to not use PKCE.

### Solution 3: Use google-auth-library

**Change**: Replace custom OAuth implementation with google-auth-library.

**Rationale**: More reliable, battle-tested implementation.

**Implementation**: Refactor gemini-oauth.ts to use OAuth2Client.

### Solution 4: Add Encrypted Storage

**Change**: Implement encrypted credential storage.

**Rationale**: Better security following reference implementation.

**Implementation**: Add encryption similar to reference-gemini-cli.

## Cost Analysis

### Authentication Method Costs

- **API Keys**: No additional cost, direct API access
- **OAuth**: No additional cost, same API usage pricing
- **Token Refresh**: Minimal API calls, no significant cost impact

### Implementation Costs

- **Development**: Low - OAuth already implemented
- **Testing**: Medium - Requires OAuth flow testing
- **Maintenance**: Low - Similar to existing Claude OAuth

## Implementation Status

### Completed Changes

1. **Phase 1 - COMPLETED (Dec 21, 2025)**: Update scopes to match reference
   - Removed `generative-language.retriever` scope from `src/auth/gemini-oauth.ts`
   - Removed `generative-language.retriever` scope from `src/auth/plugins.ts`
   - Updated tests to reflect scope changes
   - All tests pass ✅

### Remaining Phases

2. **Phase 2**: Test OAuth flow with updated scopes (PENDING)
3. **Phase 3**: If issues persist, implement google-auth-library replacement (PENDING)
4. **Phase 4**: Add encrypted storage for production security (PENDING)

## Timeline

- Phase 1: COMPLETED
- Phase 2: 1-2 days testing
- Phase 3: 3-5 days (if needed)
- Phase 4: 2-3 days

## Risk Assessment

- **Low Risk**: Scope changes ✅ COMPLETED
- **Medium Risk**: Library replacement
- **Low Risk**: Encrypted storage addition

## Success Criteria

- OAuth authentication flow completes successfully
- Gemini models accessible via OAuth credentials
- Token refresh works automatically
- No breaking changes to existing API key authentication
