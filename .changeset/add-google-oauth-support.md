---
'@link-assistant/agent': minor
---

Add Google OAuth support for Gemini Pro/Ultra subscriptions

- Implements OAuth 2.0 with PKCE for Google AI subscription authentication
- Uses same public OAuth credentials as official Gemini CLI (installed app flow)
- Adds local HTTP server to automatically capture OAuth redirect
- Supports token refresh with 5-minute expiry buffer
- Zeros out cost tracking for subscription users
- Creates case study documentation in docs/case-studies/issue-66/
- Fixes #66
