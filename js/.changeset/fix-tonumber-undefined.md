---
'@link-assistant/agent': patch
---

Fix toNumber returning NaN for undefined values and extract nested cache/reasoning tokens

- Changed `toNumber()` to return 0 instead of NaN for undefined/null inputs (issue #127)
- This fixes alarming debug logs like "toNumber error - returning NaN" for optional fields
- Added extraction of `cacheRead` from nested `inputTokens` object
- Added extraction of `reasoning` from nested `outputTokens` object
- This enables proper token tracking for providers like `opencode/grok-code` that nest these values
