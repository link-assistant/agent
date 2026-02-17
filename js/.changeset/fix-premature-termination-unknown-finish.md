---
'@link-assistant/agent': patch
---

fix: prevent premature termination when finishReason is unknown

When using certain AI providers (like Kimi K2.5 via OpenCode), the API may return `undefined` for `finishReason` after tool calls, which gets converted to `"unknown"`. This caused the agentic loop to exit prematurely before executing any planned tasks.

This fix implements three safeguards:

1. **Strict model validation**: `parseModelWithResolution()` now throws `ModelNotFoundError` instead of silently falling back to a default model, preventing model mismatch issues.

2. **Finish reason inference**: When `finishReason` is undefined but pending tool calls exist, infer `'tool-calls'` as the finish reason to continue the loop.

3. **Safe loop exit**: When finish reason is `'unknown'`, check if tool calls were made and continue the loop if detected.

Fixes #194
