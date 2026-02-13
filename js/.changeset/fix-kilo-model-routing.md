---
'@link-assistant/agent': patch
---

Fix explicit provider/model routing for Kilo provider

When users specify an explicit provider/model combination like `kilo/glm-5-free`, the system now correctly uses that provider instead of silently falling back to the default (opencode).

- Add resolveShortModelName() to route short model names to providers
- Add parseModelWithResolution() for model string parsing with resolution
- Modify prompt.ts to throw error instead of falling back on explicit provider
- Add getAlternativeProviders() for rate limit fallback on shared models
- Document free model distribution between OpenCode and Kilo
