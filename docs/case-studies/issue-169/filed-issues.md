# Filed Issues for Case Study #169

Issues filed as part of the investigation into premature session termination
due to SSE stream corruption and unhandled `AI_JSONParseError`.

## Filed Issues

1. **Vercel AI SDK** — [vercel/ai#12595](https://github.com/vercel/ai/issues/12595)
   - Title: AI_JSONParseError should support retry for mid-stream parse errors
   - Requests `isRetryable` property, `onStreamParseError` callback, or stream-level retry config

2. **Kilo AI Gateway** — [Kilo-Org/kilocode#5875](https://github.com/Kilo-Org/kilocode/issues/5875)
   - Title: SSE stream corruption when proxying Kimi K2.5 — chunks concatenated without delimiters
   - Reports the specific SSE violation observed in production logs

3. **OpenCode (upstream)** — [anomalyco/opencode#13579](https://github.com/anomalyco/opencode/issues/13579)
   - Title: AI_JSONParseError during SSE streaming is not retried (falls to NamedError.Unknown)
   - Reports the same bug in the upstream project with proposed fix

## Related Existing Issues

- [Kilo-Org/kilocode#5433](https://github.com/Kilo-Org/kilocode/issues/5433): Kimi K2.5 - Fails with Kilo Gateway
- [anomalyco/opencode#7692](https://github.com/anomalyco/opencode/issues/7692): JSON Parse Error with GLM-4.7 stream chunks concatenated
- [anomalyco/opencode#8431](https://github.com/anomalyco/opencode/issues/8431): GLM 4.7 AI_JSONParseError
- [vercel/ai#4099](https://github.com/vercel/ai/issues/4099): streamText error handling
- [vercel/ai#8577](https://github.com/vercel/ai/issues/8577): AI_JSONParseError with generateText
- [sglang#8613](https://github.com/sgl-project/sglang/issues/8613): Kimi-K2 incomplete content during streaming
