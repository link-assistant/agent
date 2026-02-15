---
'@link-assistant/agent': patch
---

fix: suppress AI SDK warnings for cleaner CLI output

- Suppress AI SDK v2 compatibility warnings by default
- Change models.dev cache fallback message from 'warn' to 'info' level
- Add `AGENT_ENABLE_AI_SDK_WARNINGS=true` to re-enable warnings if needed
