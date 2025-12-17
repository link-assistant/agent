---
'@link-assistant/agent': patch
---

Fix empty system message handling for Anthropic OAuth credentials

When using Claude Code OAuth credentials with an empty `--system-message ""`, the agent now preserves the required "You are Claude Code" header message. This prevents:

- `cache_control cannot be set for empty text blocks` errors
- `This credential is only authorized for use with Claude Code` errors

The fix ensures OAuth token authorization works correctly even when users explicitly set an empty system message.

Fixes #62
