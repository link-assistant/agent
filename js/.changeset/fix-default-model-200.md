---
"@link-assistant/agent": patch
---

fix: change default model from removed kimi-k2.5-free to kilo/glm-5-free and improve error serialization

- Fixed default model from removed `opencode/kimi-k2.5-free` to stable `kilo/glm-5-free`
- Added cyclic-reference-safe JSON serialization for all output
- Improved global error handlers with guaranteed JSON output
- Added model resolution verbose logging for debugging
