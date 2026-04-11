# Case Study: Issue #249 — Compaction Threshold Best Practices

## Summary

Context overflow error occurred when `nemotron-3-super-free` (262,144 context)
received a request with 230,145 input tokens + 32,000 output tokens = 262,145 tokens,
exceeding the hard limit by 1 token. Compaction never triggered because the provider
returned 0 for all token counts.

## Root Causes

### 1. Provider returns 0 token counts

The Nvidia/nemotron provider (via OpenCode) returned 0 for `inputTokens`,
`outputTokens`, and all other usage fields. The `isOverflow()` function computed
`currentTokens = 0 + 0 + 0 = 0`, which is always below any `safeLimit`,
so compaction was never triggered.

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

1. Session starts with `nemotron-3-super-free` (context: 262,144)
2. Multiple turns execute; overflow checks all show `currentTokens: 0`
3. Input grows to 230,145 tokens (estimated ~920,580 characters)
4. Request sent with `max_tokens: 32000` → total 262,145 > 262,144
5. Nvidia returns: `"This model's maximum context length is 262144 tokens"`

## Files Changed

- `js/src/util/token.ts` — Add `countTokens()` with real BPE via gpt-tokenizer, heuristic fallback
- `js/src/session/compaction.ts` — Lower margin, add estimation fallback
- `js/src/session/prompt.ts` — Use `Token.countTokens()` for overflow detection, cap output tokens
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
