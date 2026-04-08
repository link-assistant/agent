---
'@link-assistant/agent': patch
---

fix: resolve Agent CLI problems preventing task completion (#239)

- `argv.ts`: harden getModelFromProcessArgv() with Bun.argv fallback for global installs (oven-sh/bun#22157)
- `model-config.js`: add diagnostic logging for model resolution, detect silent Bun/yargs argument parsing mismatch
- `storage.ts`: sanitize null bytes in migration paths before file operations
- `prompt.ts`: check for completed tool calls BEFORE zero-token check — prevents premature session termination when provider reports zero tokens but model executed tool calls successfully
