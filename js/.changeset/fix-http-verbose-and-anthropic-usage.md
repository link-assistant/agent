---
'@link-assistant/agent': patch
---

fix: HTTP verbose logging and anthropic provider usage fallback (#211)

Two fixes for issues observed when running the Agent CLI with `--verbose`
mode and the `opencode/minimax-m2.5-free` model:

1. **HTTP request/response logging not appearing in verbose mode**: The
   lazy log callback pattern (`log.info(() => ({...}))`) passed through
   the `log-lazy` npm package, adding indirection that could lose output
   when the CLI runs as a subprocess. Changed all 5 HTTP log call sites
   to use direct calls (`log.info('msg', data)`) since the verbose check
   is already done at the top of the wrapper.

2. **"Provider returned zero tokens with unknown finish reason" error**:
   When using `@ai-sdk/anthropic` SDK with a custom baseURL (opencode
   proxy), the standard AI SDK usage object is empty but
   `providerMetadata.anthropic.usage` contains valid token data with
   snake_case keys (`input_tokens`, `output_tokens`). Added an anthropic
   metadata fallback in `getUsage()` to extract tokens from this
   metadata, similar to the existing OpenRouter fallback.
