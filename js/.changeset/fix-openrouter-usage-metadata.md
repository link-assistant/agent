---
'@link-assistant/agent': patch
---

fix: extract usage and finish reason from OpenRouter provider metadata

When using OpenRouter-compatible APIs (like Kilo Gateway), the standard AI SDK usage object may be empty while the actual usage data is in `providerMetadata.openrouter.usage`. This fix adds fallback logic to extract token counts and finish reason from provider metadata.

This enables accurate token counting and cost calculation for all OpenRouter-compatible providers including Kilo Gateway.
