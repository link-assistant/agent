---
'@link-assistant/agent': patch
---

Fix system message override to use exclusively without additional context for low-limit models. When --system-message flag is provided, the system now returns only that message without adding environment info, custom instructions, or headers. This reduces token usage from ~9,059 to ~30 tokens, enabling support for models with low TPM limits like groq/qwen/qwen3-32b (6K TPM).

Also adds --verbose mode to debug API requests with system prompt content and token estimates.
