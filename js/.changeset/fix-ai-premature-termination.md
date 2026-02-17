---
'@link-assistant/agent': patch
---

Fix AI agent premature termination with unknown finish reason

This patch addresses issue #194 where the AI agent terminated prematurely after creating a todo list but before executing any tasks. The root causes were:

1. **Silent model fallback**: The system silently fell back from the requested `glm-4.7-free` to `kimi-k2.5-free` without warning
2. **Missing finishReason**: Kimi K2.5 API returns `undefined` for `finishReason` after tool calls
3. **Premature loop exit**: The agentic loop treated `"unknown"` finish reason the same as `"stop"`

Solutions implemented:

- `parseModelWithResolution()` now throws `ModelNotFoundError` instead of silently falling back
- When `finishReason` is undefined but pending tool calls exist, infer `'tool-calls'`
- Continue the agentic loop when finish reason is `'unknown'` but tool calls were made
