# Filed Issues for Case Study #169

Issues filed as part of the investigation into premature session termination
due to SSE stream corruption and unhandled `AI_JSONParseError`.

## Filed Issues

1. **Vercel AI SDK** — [vercel/ai#12595](https://github.com/vercel/ai/issues/12595)
   - Title: AI_JSONParseError should support retry for mid-stream parse errors
   - Requests `isRetryable` property, `onStreamParseError` callback, or stream-level retry config
   - **Update**: The SDK already handles this correctly (emits error event, stream continues).
     The real issue is that consumers throw on error events. Updated draft recommends
     documenting the skip-and-continue pattern.

2. **OpenCode (upstream)** — [anomalyco/opencode#13579](https://github.com/anomalyco/opencode/issues/13579)
   - Title: AI_JSONParseError during SSE streaming is not retried (falls to NamedError.Unknown)
   - Reports the same bug in the upstream project
   - **Update**: The fix should be skip-and-continue (like Codex), not retry.
     `processor.ts` should detect `JSONParseError` in `case 'error'` and `continue`
     instead of `throw value.error`.

3. **Kilo AI Gateway** — ~~[Kilo-Org/kilocode#5875](https://github.com/Kilo-Org/kilocode/issues/5875)~~
   - **Correction**: Kilo Gateway was NOT involved in this incident.
     The actual gateway was OpenCode Zen (`opencode.ai/zen/v1`).
     The `kimi-k2.5-free` model resolved to `opencode` provider, not `kilo`.

## Corrected Provider Chain

```
Agent (Bun) → OpenCode Zen (opencode.ai/zen/v1) → Moonshot Kimi K2.5 API
```

Evidence from logs:
```
[2026-02-14T08:29:06.525Z] "providerID": "opencode"
[2026-02-14T08:29:06.525Z] "modelID": "kimi-k2.5-free"
```

The OpenCode provider's base URL is `https://opencode.ai/zen/v1` (from models.dev database).

## Related Existing Issues

- [anomalyco/opencode#7692](https://github.com/anomalyco/opencode/issues/7692): JSON Parse Error with GLM-4.7 stream chunks concatenated
- [anomalyco/opencode#10967](https://github.com/anomalyco/opencode/issues/10967): Error Writing Large Files with Kimi K2.5
- [vercel/ai#4099](https://github.com/vercel/ai/issues/4099): streamText error handling
- [sglang#8613](https://github.com/sgl-project/sglang/issues/8613): Kimi-K2 incomplete content during streaming
