# CLI Agent Comparison: SSE Stream Parse Error Handling

Analysis of how major CLI agents handle SSE stream parse errors (like `AI_JSONParseError`),
conducted as part of the investigation for [issue #169](https://github.com/link-assistant/agent/issues/169).

## Summary Table

| Feature | OpenAI Codex | Gemini CLI | Qwen Code | OpenCode | This Agent |
|---------|-------------|------------|-----------|----------|------------|
| **Language** | Rust | TypeScript | TypeScript | TypeScript | TypeScript |
| **SSE Parser** | `eventsource_stream` crate | Custom (`readline`) | Delegates to SDK | `eventsource-parser` (via AI SDK) | `eventsource-parser` (via AI SDK) |
| **JSON parse error in SSE** | Skip & continue | Not caught (gap) | Silent skip + warn log | Falls to UnknownError (gap) | StreamParseError + retry (fix) |
| **Stream-level retry** | Yes (5 retries, exp backoff) | Yes (2 attempts for InvalidStreamError) | Yes (1 retry for InvalidStreamError, 10 for rate limits) | No | Yes (3 retries, exp backoff) |
| **Connection retry** | Yes (4 retries, exp backoff) | Yes (3 retries, exp backoff + jitter) | Yes (7 retries, exp backoff + jitter) | Depends on AI SDK `maxRetries` | Depends on AI SDK `maxRetries` |
| **Transport fallback** | WebSocket → HTTP fallback | No | No | No | No |
| **Idle timeout** | 5 min (configurable) | No | No | No | No |
| **AI SDK maxRetries** | N/A (own HTTP client) | N/A (own HTTP client) | N/A (own HTTP client) | 0 (disabled) | Default (2) |

## Detailed Analysis

### OpenAI Codex CLI — Best Practice

**Approach**: Skip-and-continue for individual bad events; stream-level retry for stream termination.

**Key design decisions**:
1. Individual SSE events that fail JSON parsing are **skipped** (logged at debug level, `continue;`)
2. SSE framing errors (protocol-level) terminate the stream → triggers stream retry
3. Stream idle timeout (5 min default) → triggers stream retry
4. Stream closed before `response.completed` → triggers stream retry
5. `CodexErr::Json` (serde JSON errors) explicitly classified as **retryable**
6. WebSocket-to-HTTP fallback when WebSocket retries exhausted
7. Configurable: `stream_max_retries: 5`, `request_max_retries: 4`

**Files**: `codex-api/src/sse/responses.rs`, `codex-rs/core/src/codex.rs`, `codex-rs/core/src/error.rs`

### Gemini CLI

**Approach**: Two-layer retry architecture (connection + stream consumption).

**Key design decisions**:
1. Layer 1: `retryWithBackoff` wraps HTTP request (3 attempts, 5s initial, 30s max)
2. Layer 2: Inner loop retries `InvalidStreamError` (no finish reason, empty response, malformed function call) — 2 attempts, 500ms delay
3. `SyntaxError` from custom SSE parser JSON.parse is **NOT caught** (gap)
4. Rate limit handling: Classifies 429 as terminal vs retryable based on quota type
5. Model fallback on persistent quota errors (Google auth only)
6. Retry event signals UI to discard partial content

**Files**: `packages/core/src/utils/retry.ts`, `packages/core/src/core/geminiChat.ts`

### Qwen Code

**Approach**: Graceful skip in SDK; stream retry for content errors and rate limits.

**Key design decisions**:
1. SDK `parseJsonLineSafe()` silently returns `null` on parse failure (logs warning)
2. `StreamContentError` for rate limits (429/503/1302) retried with 60s delay, up to 10 times
3. `InvalidStreamError` (no finish reason, empty response) retried once with 500ms delay
4. Rate limit retries don't count against content retry limit
5. Credential refresh on 401/403 (Qwen-specific)
6. `error_finish` in SSE chunk data detected and thrown as `StreamContentError`

**Files**: `packages/sdk-typescript/src/utils/jsonLines.ts`, `packages/core/src/core/geminiChat.ts`

### OpenCode (sst/opencode) — This Project's Upstream

**Approach**: AI SDK error classification; only API errors with `isRetryable` are retried.

**Key findings**:
1. `AI_JSONParseError` falls through to `NamedError.Unknown` — **NOT retried**
2. `ECONNRESET` explicitly classified as retryable `APIError`
3. Raw SSE error objects (non-Error instances) parsed via `parseStreamError()` — all `isRetryable: false`
4. The `retryable()` function tries to JSON.parse the error message — returns any parseable JSON as retryable
5. AI SDK `maxRetries: 0` (disabled) — no built-in retries
6. Custom SDK SSE client has its own exponential backoff for connection failures

**Files**: `packages/opencode/src/session/message-v2.ts`, `packages/opencode/src/session/retry.ts`

## Recommendations for This Agent

Based on the comparison:

1. **Short-term** (implemented): Classify `AI_JSONParseError` as `StreamParseError` (retryable) in `message-v2.ts`
2. **Medium-term**: Consider the Codex "skip-and-continue" approach — this is more resilient than retrying the entire stream
3. **Long-term**: File upstream issues for Vercel AI SDK and Kilo Gateway
