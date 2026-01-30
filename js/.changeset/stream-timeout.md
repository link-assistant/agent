---
'@link-assistant/agent': patch
---

Add stream timeout to prevent agent CLI from hanging indefinitely when LLM API connections stall. Configurable via AGENT_STREAM_CHUNK_TIMEOUT_MS (default: 2min) and AGENT_STREAM_STEP_TIMEOUT_MS (default: 10min) environment variables.
