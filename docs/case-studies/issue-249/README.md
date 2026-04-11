# Case Study: Issue #249 — Compaction Threshold Best Practices

## Summary

Context overflow error occurred when `nemotron-3-super-free` (262,144 context)
received a request with 230,145 input tokens + 32,000 output tokens = 262,145 tokens,
exceeding the hard limit by 1 token. Compaction never triggered because the provider
returned 0 for all token counts.

## Root Causes

### 1. AI SDK fails to propagate token usage from raw HTTP response

**Deep investigation revealed the provider DOES return valid usage data** in the
raw HTTP SSE stream. The final streaming chunk from OpenRouter contains:

```json
"usage": {
  "prompt_tokens": 15506,
  "completion_tokens": 80,
  "total_tokens": 15586,
  "completion_tokens_details": { "reasoning_tokens": 19 }
}
```

However, the AI SDK's `@ai-sdk/openai-compatible` v1.0.33 fails to propagate
these values to the `finish-step` event. The `step-finish` event consistently
shows all zeros:

```json
"tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } }
```

**Evidence from verbose HTTP logs (line 2663 of original-failure-log.txt):**
The raw HTTP response body stream was captured by `verbose-fetch.ts` and clearly
shows the SSE chunk with `"prompt_tokens":15506,"completion_tokens":80`.

**Why does this happen?** The AI SDK `@ai-sdk/openai-compatible` v1.0.33 should:
1. Parse the SSE chunk's `usage.prompt_tokens` → `usage.promptTokens`
2. Emit finish event with `inputTokens: usage.promptTokens`
3. AI SDK core converts via `convertV2UsageToV3` → `{inputTokens: {total: N}}`
4. `asLanguageModelUsage` reads `usage.inputTokens.total`

The exact point of failure in steps 1-4 is within the AI SDK internals and
difficult to isolate without a dedicated reproducer. The schema, SSE parsing,
and mapping code all appear correct on inspection. A potential cause is a
race condition in stream processing, or an incompatibility between
`@ai-sdk/openai-compatible` v1.0.33 and `ai` v6.0.1.

**This is an upstream AI SDK issue** that should be reported to the Vercel AI
SDK repository with a reproducible example using OpenRouter + streaming.

### 1b. Overflow detection used only provider-reported tokens (no fallback)

Because the step-finish event showed 0 tokens, the `isOverflow()` function
computed `currentTokens = 0 + 0 + 0 = 0`, which is always below any
`safeLimit`, so compaction was never triggered.

**Evidence from logs:**
```
"currentTokens": 0,
"tokensBreakdown": { "input": 0, "cacheRead": 0, "output": 0 },
"overflow": false,
"headroom": 146880
```

This pattern repeated for every single overflow check in the session —
all 10+ checks showed `currentTokens: 0`.

### 2. max_tokens not capped to available context

The system always requested `max_tokens: 32000` regardless of how much input
was in the prompt. When input grew to 230,145 tokens:
- Available: 262,144 - 230,145 = 31,999 tokens
- Requested: 32,000 tokens
- Total: 262,145 > 262,144 → **error**

### 3. Safety margin too narrow

The 85% threshold (15% margin) assumed providers would return accurate token
counts. When they don't, a larger margin is needed as a safety buffer.

## Research: Industry Compaction Thresholds

| Tool | Threshold | Margin | Notes |
|------|-----------|--------|-------|
| Gemini CLI | 50% | 50% | Most conservative; configurable |
| OpenCode (upstream sst/opencode) | 75% | 25% | Hardcoded 0.75 |
| Claude Code | ~83.5% | ~16.5% | Reduced buffer in 2026 |
| Codex CLI | ~95% | ~5% | Users report "too late" |
| link-assistant/agent (before) | 85% | 15% | |
| link-assistant/agent (after) | 75% | 25% | Matches OpenCode upstream |

**Community consensus:** 80-90% is the recommended range, with 85-90% as the
sweet spot when token counting is reliable. When token counting is unreliable
(as in our case), a lower threshold is safer.

## Fixes Applied

### Fix 1: Lower safety margin from 85% to 75%

- `OVERFLOW_SAFETY_MARGIN`: 0.85 → 0.75
- `DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT`: 15 → 25
- Updated in both JS (`compaction.ts`, `defaults.ts`) and Rust (`cli.rs`)

### Fix 2: Token estimation fallback with BPE tokenization

Added `estimatedInputTokens` parameter to `isOverflow()`. When the provider
returns 0 for all token counts, the system counts tokens from message content
using real BPE tokenization (`gpt-tokenizer` with `o200k_base` encoding) when
available, falling back to a character-based heuristic (~4 chars/token) for
models with unknown tokenizers.

**Why not always use real BPE?** Different LLM providers use different tokenizers:
- OpenAI models (GPT-4o, GPT-4.1, GPT-5): `o200k_base` BPE — supported via `gpt-tokenizer`
- Nvidia Nemotron: Custom SentencePiece BPE (256K vocab) — no JS library available
- Google Gemini: SentencePiece — no JS library available
- Meta Llama: SentencePiece — no JS library available
- Anthropic Claude: Proprietary BPE (~65K vocab) — not publicly available

Since the failing model (Nemotron) uses a tokenizer unavailable in JS, real BPE
cannot guarantee accuracy for all providers. The 75% safety margin (25% buffer)
absorbs the ±20% estimation error inherent in both the heuristic and cross-tokenizer
estimation.

### Fix 3: Cap maxOutputTokens to context limit

Added `capOutputTokensToContext()` that ensures `estimatedInput + maxOutput`
never exceeds the model's context limit. This is the last line of defense:
even if compaction doesn't trigger in time, the request won't exceed the
model's hard limit.

## Timeline

1. Session starts with `nemotron-3-super-free` (context: 262,144) via OpenCode/OpenRouter
2. Request is sent with `"stream": true, "stream_options": {"include_usage": true}`
3. OpenRouter returns valid SSE stream with `prompt_tokens: 15506, completion_tokens: 80`
4. AI SDK `@ai-sdk/openai-compatible` receives the stream but reports 0 tokens in finish-step
5. `isOverflow()` computes `currentTokens = 0`, compaction never triggers
6. Multiple turns execute; this pattern repeats 10+ times with growing context
7. Input grows to 230,145 tokens (estimated ~920,580 characters)
8. Request sent with `max_tokens: 32000` → total 262,145 > 262,144
9. Nvidia returns: `"This model's maximum context length is 262144 tokens"`

## Raw Request/Response Logging

The codebase already has comprehensive HTTP request/response logging via
`verbose-fetch.ts` (enabled with `--verbose` flag). This logs:

- **Request**: method, URL, sanitized headers, body preview
- **Response**: status, headers, duration, body preview
- **Streaming responses**: Full SSE stream body captured via `response.body.tee()`
- **Errors**: Stack traces, error cause chains

This logging **proved essential** for this investigation — it captured the raw
OpenRouter SSE response showing valid `prompt_tokens: 15506` despite the AI SDK
reporting 0 tokens at the step-finish level.

**Additional diagnostic logging added in this PR:**
- `processor.ts`: Step-finish raw usage diagnostics (verbose mode) — logs both
  the AI SDK's parsed usage and the raw `value.usage` from the finish-step event
- `processor.ts`: Enhanced zero-token warning — now fires regardless of
  finishReason, with a hint pointing to verbose HTTP logs for the raw response
- `session/index.ts`: `getUsage()` already logs raw usage data in verbose mode

## Upstream Issue Recommendations

### Vercel AI SDK: `@ai-sdk/openai-compatible` streaming usage not propagated

The raw HTTP response from OpenRouter contains valid `prompt_tokens` and
`completion_tokens` in the final SSE chunk, but the AI SDK's step-finish event
reports 0 for all token counts. This should be reported to `vercel/ai` with:

- **Steps to reproduce**: Use `@ai-sdk/openai-compatible` v1.0.33 + `ai` v6.0.1,
  call `streamText()` with an OpenRouter endpoint that proxies to a free-tier
  model (e.g., `nvidia/nemotron-3-super-free`)
- **Expected**: `onStepFinish` usage reflects the provider's usage from the SSE stream
- **Actual**: All token counts are 0
- **Evidence**: Raw HTTP response captured by verbose-fetch shows valid usage data
- **Workaround**: Token estimation fallback + lower safety margin (this PR)

## Files Changed

- `js/src/util/token.ts` — Add `countTokens()` with real BPE via gpt-tokenizer, heuristic fallback
- `js/src/session/compaction.ts` — Lower margin, add estimation fallback
- `js/src/session/prompt.ts` — Use `Token.countTokens()` for overflow detection, cap output tokens
- `js/src/session/processor.ts` — Enhanced zero-token diagnostics and verbose logging
- `js/src/cli/defaults.ts` — Update default margin percentage
- `rust/src/cli.rs` — Sync Rust default
- `js/tests/compaction-model.test.ts` — Update tests, add estimation tests
- `js/tests/token.test.ts` — Tests for Token.estimate and Token.countTokens

## References

- [Issue #249](https://github.com/link-assistant/agent/issues/249)
- [Solution draft log](./solution-draft-log.txt) — Full gist log from failed session
- [Issue #217](https://github.com/link-assistant/agent/issues/217) — Original safety margin implementation
- [Issue #219](https://github.com/link-assistant/agent/issues/219) — Separate compaction model
- [Context Compaction Research](https://gist.github.com/badlogic/cd2ef65b0697c4dbe2d13fbecb0a0a5f) — Cross-tool comparison
- [OpenCode compaction threshold](https://deepwiki.com/sst/opencode/2.4-context-management-and-compaction) — 75% default
- [Gemini CLI compaction](https://wasnotwas.com/writing/context-compaction/) — 50% default
