---
'@link-assistant/agent': patch
---

Handle AI SDK unified/raw format in toFinishReason

- Added handling for `unified` field in `toFinishReason()` function
- AI SDK may return finishReason as `{unified: "tool-calls", raw: "tool_calls"}`
- Previously this caused JSON.stringify fallback, breaking loop exit condition
- Agent now correctly continues processing after tool calls

Fixes #129
