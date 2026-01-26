# Case Study: Issue #93 - Google OAuth Authentication Failure

## Issue Summary

**Title:** agent auth login через Google не работает
**Issue URL:** https://github.com/link-assistant/agent/issues/93
**Reporter:** @andchir
**Date:** 2025-12-22

## Problem Description

When attempting to authenticate via `agent auth login` using Google OAuth, users encounter a `403: restricted_client` error with the message:

```
Доступ заблокирован: ошибка авторизации
Unregistered scope(s) in the request: https://www.googleapis.com/auth/generative-language.tuning, https://www.googleapis.com/auth/generative-language.retriever
```

The affected authentication methods are:

- Google AI Pro/Ultra (OAuth - Browser)
- Google AI Pro/Ultra (OAuth - Manual Code Entry)

## Root Cause Analysis

### Investigation

The error message clearly indicates that two OAuth scopes are not registered for the OAuth client:

1. `https://www.googleapis.com/auth/generative-language.tuning`
2. `https://www.googleapis.com/auth/generative-language.retriever`

### Code Location

The problematic scopes were defined in `src/auth/plugins.ts` at lines 857-863:

```typescript
const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/generative-language.tuning', // <-- UNREGISTERED
  'https://www.googleapis.com/auth/generative-language.retriever', // <-- UNREGISTERED
];
```

### Root Cause

The OAuth client ID used (`681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com`) is from the official Gemini CLI. However, this client only has specific scopes registered:

- `https://www.googleapis.com/auth/cloud-platform`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/userinfo.profile`

The `generative-language.tuning` and `generative-language.retriever` scopes were incorrectly added, likely with the assumption they would be useful for advanced Gemini features. However, these scopes are:

1. Not registered for this particular OAuth client
2. Not necessary for basic Gemini API access through OAuth

## Reference Implementation Analysis

### Gemini CLI (Official Google Implementation)

Source: https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/oauth2.ts

Uses only 3 scopes:

```javascript
const OAUTH_SCOPE = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];
```

## Solution

Remove the unregistered scopes from `GOOGLE_OAUTH_SCOPES` to match the official Gemini CLI implementation.

### Before (Broken)

```typescript
const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/generative-language.tuning',
  'https://www.googleapis.com/auth/generative-language.retriever',
];
```

### After (Fixed)

```typescript
const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];
```

## Timeline

1. **2025-12-22:** Issue reported by @andchir
2. **2025-12-22:** Issue assigned for investigation
3. **2025-12-22:** Root cause identified - unregistered OAuth scopes
4. **2025-12-22:** Fix implemented - removed unregistered scopes to align with Gemini CLI

## Lessons Learned

1. When using third-party OAuth client credentials, always verify which scopes are registered for that client
2. Reference the official implementation when integrating with external OAuth providers
3. OAuth scope errors manifest as `403: restricted_client` when requesting unregistered scopes
