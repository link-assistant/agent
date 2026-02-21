---
'@link-assistant/agent': patch
---

fix: improve error serialization and verbose debug output for model resolution

- Added cyclic-reference-safe JSON serialization for all error output
- Improved global error handlers with guaranteed JSON output and last-resort fallback
- Added model resolution verbose logging for debugging
- Restored `opencode/kimi-k2.5-free` as default model (confirmed available on models.dev)
