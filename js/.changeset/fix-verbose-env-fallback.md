---
'@link-assistant/agent': patch
---

fix: remove legacy OPENCODE\_\* env vars, rename Flag exports, add env var fallback for verbose flag (#227)

- Removed all `OPENCODE_*` environment variable support; use `LINK_ASSISTANT_AGENT_*` exclusively
- Renamed `Flag.OPENCODE_*` exports to clean names (e.g., `Flag.VERBOSE`, `Flag.DRY_RUN`, `Flag.CONFIG`)
- Added env var propagation in `setVerbose()` to prevent silent HTTP logging loss in subprocess scenarios
- Added `Flag.isVerbose()` with env var fallback for resilience
