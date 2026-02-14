# CLI Agent Comparison: SSE Stream Parse Error Handling

Analysis of how major CLI agents handle SSE stream parse errors (like `AI_JSONParseError`),
conducted as part of the investigation for [issue #169](https://github.com/link-assistant/agent/issues/169).

## Summary Table

| Feature | OpenAI Codex | Gemini CLI | Qwen Code | OpenCode | This Agent (fix) |
|---------|-------------|------------|-----------|----------|-----------------|
| **Language** | Rust | TypeScript | TypeScript | TypeScript | TypeScript |
| **SSE Parser** | `eventsource_stream` crate | `@google/genai` SDK `SSEDecoder` | Delegates to `openai` npm | `eventsource-parser` (via AI SDK) | `eventsource-parser` (via AI SDK) |
| **JSON parse error in SSE** | Skip & continue | throw in SDK (gap) | SDK JSONL: skip. OpenAI path: no safe parse | Falls to UnknownError (gap) | **Skip & continue (Codex approach)** |
| **Stream continues?** | Yes | No | Partial (SDK JSONL only) | No | **Yes** |

## Detailed Analysis

### OpenAI Codex CLI — Best Practice

**Approach**: Skip-and-continue for individual bad events.

**Key code** (`codex-api/src/sse/responses.rs:373-379`):
```rust
let event: ResponsesStreamEvent = match serde_json::from_str(&sse.data) {
    Ok(event) => event,
    Err(e) => {
        debug!("Failed to parse SSE event: {e}, data: {}", &sse.data);
        continue;  // Skip and continue processing the stream
    }
};
```

**Design philosophy**:
- Individual SSE events that fail JSON parsing are **skipped** (logged at debug level)
- SSE framing errors (protocol-level) terminate the stream → triggers stream retry
- A single corrupted chunk should never terminate an entire session

### Gemini CLI

**Approach**: Delegates to `@google/genai` SDK which throws on JSON parse errors.

**Key finding**: The `@google/genai` SDK's `Stream.fromSSEResponse()` catches JSON parse errors,
logs them, and **re-throws** — the error propagates up and terminates the stream.
`SyntaxError` from `JSON.parse` is neither an `InvalidStreamError` nor a retryable error.

**Gap**: Same as OpenCode — JSON parse errors during SSE consumption terminate the stream.

### Qwen Code

**Approach**: Two different paths with different behavior.

**SDK JSONL transport** (`packages/sdk-typescript/src/utils/jsonLines.ts`):
```typescript
export function parseJsonLineSafe(line, context) {
  try {
    return JSON.parse(line);
  } catch (error) {
    logger.warn('Failed to parse JSON line, skipping:', line.substring(0, 100));
    return null;  // Caller skips
  }
}
```

**OpenAI-compatible streaming**: Delegates to `openai` npm package. No safe parse for SSE events.

**Gap**: The safe parse only protects the SDK's own JSON Lines mode, not the OpenAI-compatible path.

### OpenCode (sst/opencode) — Upstream

**Approach**: AI SDK error classification; throws on all stream error events.

**Key finding**: `processor.ts` has `case 'error': throw value.error;` — identical to our bug.
`AI_JSONParseError` falls through to `NamedError.Unknown` in `fromError()` — not retried.

**Critical nuance**: The Vercel AI SDK actually emits the error as a stream event and
**continues the stream transform**. It is the consumer (`processor.ts`) that terminates
the session by throwing on the error event.

### This Agent — Fix Applied

**Approach**: Skip-and-continue (Codex approach).

```typescript
case 'error':
  if (JSONParseError.isInstance(value.error)) {
    log.warn(() => ({
      message: 'skipping malformed SSE event (stream parse error)',
      errorName: value.error?.name,
      errorMessage: value.error?.message?.substring(0, 200),
    }));
    continue;  // Skip and continue, like Codex
  }
  throw value.error;  // Other errors still terminate
```

**Why skip, not retry**:
- The Vercel AI SDK continues the stream after emitting the error event
- Subsequent chunks may be valid — no need to restart the entire stream
- Retrying would lose all progress made before the corrupted event
- This matches the OpenAI Codex pattern — proven in production
