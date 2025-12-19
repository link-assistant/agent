## Online Research Findings

### Official Google Documentation

- **OAuth Quickstart**: https://ai.google.dev/gemini-api/docs/oauth
  - OAuth is the recommended authentication method for Gemini subscriptions
  - Desktop applications should use installed app flow with public client credentials
  - OAuth provides stricter access controls compared to API keys
- **OAuth 2.0 Scopes**: https://developers.google.com/identity/protocols/oauth2/scopes
  - Comprehensive list of available OAuth scopes for Google APIs
  - Sensitive scopes require Google review
  - generative-language scopes are documented for AI services

### OAuth Scopes Analysis

- **Standard Scopes Used**:
  - `https://www.googleapis.com/auth/cloud-platform`: Access to Google Cloud Platform
  - `https://www.googleapis.com/auth/userinfo.email`: Access to user's email
  - `https://www.googleapis.com/auth/userinfo.profile`: Access to basic profile info
- **Additional Scope in Implementation**:
  - `https://www.googleapis.com/auth/generative-language.retriever`: Added in PR #74 for Gemini API access
  - This scope enables access to Gemini models with subscription benefits
  - Required for Google AI Pro/Ultra subscription features

### Reference Implementation Comparison

- **Gemini CLI (google-gemini/gemini-cli)**:
  - Uses identical OAuth credentials (public for desktop apps)
  - Implements local HTTP server for OAuth callback
  - Uses google-auth-library v9.11.0
  - Scopes: cloud-platform, userinfo.email, userinfo.profile (no generative-language.retriever)
  - Has multiple OAuth-related issues reported

### Known Gemini CLI OAuth Issues

- **Issue #1696**: Authentication fails on remote servers/headless environments
  - OAuth flow requires browser interaction, problematic for headless setups
- **Issue #3924**: "API keys are not supported by this API - Expected OAuth2 access token"
  - Some endpoints require OAuth even when API keys were previously accepted
- **Issue #2040**: OAuth callback configuration for Docker compatibility
  - Docker environments need special OAuth redirect handling
- **Issue #5687**: OAuth token request fails without 'Accept: application/json' header
  - Token endpoint requires specific content-type headers
- **Issue #885af07**: OAuth token not loaded unless running from ~/.gemini
  - Path dependency issues with OAuth credential storage

### Security Considerations

- **Public Credentials**: The OAuth client ID/secret are intentionally public for installed applications
- **PKCE Required**: Proof Key for Code Exchange is mandatory for security
- **State Validation**: Prevents CSRF attacks during OAuth flow
- **Token Refresh**: Automatic refresh with 5-minute expiry buffer
- **Scope Management**: Fine-grained access control for generative AI data

### User Experience

- **Browser Launch**: Automatic browser opening for authentication
- **Local Server**: HTTP server captures OAuth redirect automatically
- **No Manual Code Copy**: Unlike deprecated out-of-band flow
- **Timeout Handling**: 5-minute timeout prevents hanging processes
- **Headless Challenges**: OAuth requires browser interaction, problematic for servers

### Subscription Details

- **Google AI Pro**: Free for college students (1 year), paid for others
- **Google AI Ultra**: $249.99 per month premium tier
- **Benefits**: Access to premium Gemini models, higher rate limits, subscription-based billing

### Related Issues & Solutions

- **Invalid Scope Errors**: Common when using incorrect or deprecated scopes
- **Scope Misconfiguration**: Can lead to insufficient authentication errors
- **Docker Compatibility**: Requires special OAuth callback configuration
- **MCP Server OAuth**: Custom MCP servers need OAuth integration for Gemini CLI

### Implementation Status

- **Current Agent Implementation**: Uses google-auth-library with local server callback
- **Scopes**: Includes generative-language.retriever (not in reference CLI)
- **Compatibility**: Maintains API key fallback for non-subscription users
- **Cost Zeroing**: Subscription users get free usage (cost = 0)
- **Error Handling**: Addresses common OAuth failure modes from Gemini CLI issues</content>
  <parameter name="filePath">docs/case-studies/issue-66/web-research-findings.md
