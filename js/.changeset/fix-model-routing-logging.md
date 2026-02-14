---
'@link-assistant/agent': minor
---

Fix Kilo provider integration: correct API endpoint, SDK, model IDs, and add device auth support (#171)

- Fix base URL from /api/gateway to /api/openrouter
- Switch SDK from @ai-sdk/openai-compatible to @openrouter/ai-sdk-provider
- Fix all model ID mappings to match actual Kilo API identifiers
- Add Kilo device auth plugin for `agent auth login`
- Add required Kilo headers (User-Agent, X-KILOCODE-EDITORNAME)
