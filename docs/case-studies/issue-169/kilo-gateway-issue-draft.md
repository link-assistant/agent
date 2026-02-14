# Note: Kilo AI Gateway was NOT involved in this incident

The original analysis incorrectly attributed the SSE corruption to Kilo AI Gateway (`api.kilo.ai`).

After re-analysis of the logs, the actual provider chain was:

```
Agent → OpenCode Zen (opencode.ai/zen/v1) → Moonshot Kimi K2.5
```

The `kimi-k2.5-free` model was resolved to the `opencode` provider (not `kilo`) via `resolveShortModelName()` in `provider.ts:1452`, which prefers OpenCode for shared models.

The Kilo Gateway issue draft is preserved here for reference, but the SSE corruption issue should be reported to OpenCode Zen / Moonshot instead.

---

## Original Draft (for reference — DO NOT file to Kilo)

### SSE stream corruption when proxying Kimi K2.5

The SSE stream returned corrupted data where two events were concatenated:

```json
{
  "text": "{\"id\":\"chatcmpl-jQugNdata:{\"id\":\"chatcmpl-iU6vkr3fItZ0Y4rTCmIyAnXO\",...}"
}
```

This issue was observed through OpenCode Zen, not Kilo Gateway.
