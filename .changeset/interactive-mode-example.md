---
'@link-assistant/agent': patch
---

docs: Add interactive mode multi-turn conversation example

Add comprehensive example in `docs/stdin-mode.md` showing how interactive terminal mode works with multiple sequential inputs.

The example demonstrates:

- Initial status message when entering interactive mode
- Complete JSON event stream for two user inputs ("hi" and "who are you?")
- Session persistence across multiple messages
- Plain text input auto-conversion to JSON
- Streaming events (step_start, text, step_finish)
- Token usage tracking in responses

Fixes #86
