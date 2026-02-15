---
'@link-assistant/agent': patch
---

fix: resolve CLI warnings by fixing root causes

- Add package staleness check to refresh 'latest' packages after 24 hours
  - Fixes specificationVersion v2 warning by ensuring @ai-sdk/openai-compatible is updated to v2.x (with v3 spec support)
- Change models.dev cache fallback message from 'warn' to 'info' level
  - Using bundled data is expected fallback behavior, not a warning condition
