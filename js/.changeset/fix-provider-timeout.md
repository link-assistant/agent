---
'@link-assistant/agent': minor
---

Bundle AI SDK providers to prevent runtime installation timeouts

- Added common AI SDK providers as static dependencies
- Created BUNDLED_PROVIDERS map to check bundled packages first
- Fall back to dynamic installation only for non-bundled providers
- Fixes issue where `--model kilo/glm-5-free` would hang indefinitely

This addresses known Bun package installation issues that cause timeouts.
