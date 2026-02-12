---
'@link-assistant/agent': minor
---

feat(google): Improve Google AI subscription support via Cloud Code API

Implements proper Google AI subscription authentication with the following improvements:

- Add user onboarding flow (loadCodeAssist + onboardUser) for automatic tier provisioning
- Add alt=sse query parameter for streaming requests (matching Gemini CLI behavior)
- Add thoughtSignature injection for Gemini 3+ function calls to prevent 400 errors
- Add retry logic with exponential backoff for transient 429/503 errors
- Add project context caching to avoid repeated onboarding API calls
- Support configurable Cloud Code API endpoint via CODE_ASSIST_ENDPOINT env var
- Use dynamic package version in x-goog-api-client header

These changes align the implementation with the official Gemini CLI and opencode-gemini-auth plugin,
enabling reliable subscription-based access without requiring API keys.
