---
'@link-assistant/agent': patch
---

Add safeguard for model argument mismatch detection

Added a safeguard to detect and correct mismatches between yargs-parsed model arguments and actual process.argv values. This addresses issue #192 where `--model kilo/glm-5-free` was incorrectly substituted with `opencode/kimi-k2.5-free` due to potential Bun runtime cache issues.

The safeguard:

- Extracts the model argument directly from process.argv
- Compares it with the yargs-parsed value
- Logs a warning and uses the correct CLI value when a mismatch is detected
