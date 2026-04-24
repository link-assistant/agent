# Deep-Dive: `normalizeProviderErrorObject` and `isUsageDataTypeError`

This document explains the two Agent CLI changes added in PR #265 at the
level of "exactly what each line does, why each line exists, what breaks if
you remove it, and how other open-source AI agent CLIs handle the same
problem". It is the companion to [`README.md`](README.md) and
[`sessions.md`](sessions.md).

The two changes together close the gap that, in session 5 of PR #1833,
turned a transient provider 5xx into a terminal `UnknownError` and stopped
`auto-restart-until-mergeable`.

---

## 1. Context: what the Vercel AI SDK emits, and what we catch

Agent CLI uses the Vercel AI SDK (`ai` package) to drive streaming model
calls. The public entry point is `streamText(...)` which returns a
`StreamTextResult`. The session processor reads the
`stream.fullStream` async iterable inside a
`while (true) { try { for await (const value of stream.fullStream) ... } catch (e) { ... } }`
loop (`js/src/session/processor.ts:111-576`).

`fullStream` can deliver two classes of failure:

1. **An `error` part inside the stream.** The AI SDK exposes `{ type: "error", error: ... }` parts. Agent CLI's processor does not have a dedicated case for them in the switch, so control falls through to the `default` branch which logs "unhandled". However, the provider-stream error also surfaces a second way, see below.
2. **An exception thrown by the SDK during stream consumption.** The most common source is the SDK's end-of-stream usage finalizer (`calculateCompletionTokenUsage`, `_retryWithExponentialBackoff`, and the `onFinish` hook), which dereferences token counts from a usage object that may be absent or partially populated when the stream ends on an error rather than a `finish-step` part. This is tracked upstream as [`vercel/ai#12477`](https://github.com/vercel/ai/issues/12477) — *AI_RetryError crashes with "Cannot read properties of undefined (reading input_tokens)" when provider returns missing usage data*. **The upstream issue is open and has no linked PR as of this writing.**

The session-5 log in PR #1833 shows both shapes occurring together: the
provider delivered an SSE `error` chunk with `{"code":524,"message":"Provider returned error"}` and no `finish-step`, the SDK then tried to finalize usage on an undefined object, and threw:

```
TypeError: undefined is not an object (evaluating 'usage.inputTokens.total')
```

The processor catch block then called `MessageV2.fromError(e, ...)` (line
579). The pre-PR behavior had no case for either shape, so both landed in
`NamedError.Unknown` (message-v2.ts:958). The retry gate
(`error?.name === 'APIError' && error.data.isRetryable`) was false, so the
processor exited, the wrapper printed "AGENT execution failed", and
auto-restart stopped.

---

## 2. `normalizeProviderErrorObject` — line-by-line

**Location:** `js/src/session/message-v2.ts:852-892`.

**Role in `fromError`:** A new `case` wired in at `message-v2.ts:929-932`
runs *before* the generic `e instanceof Error` fallback:

```ts
case normalizeProviderErrorObject(e) !== undefined: {
  const providerError = normalizeProviderErrorObject(e)!;
  return new MessageV2.APIError(providerError, { cause: e }).toObject();
}
```

The function itself:

```ts
function normalizeProviderErrorObject(e: unknown) {
  if (!e || typeof e !== 'object') return;

  const root = e as Record<string, unknown>;
  const candidate =
    root['error'] && typeof root['error'] === 'object'
      ? (root['error'] as Record<string, unknown>)
      : root;
  const rawCode =
    candidate['code'] ?? candidate['statusCode'] ?? candidate['status'];
  const statusCode =
    typeof rawCode === 'number'
      ? rawCode
      : typeof rawCode === 'string' && /^\d+$/.test(rawCode)
        ? Number.parseInt(rawCode, 10)
        : undefined;

  if (statusCode === undefined) return;

  let responseBody: string | undefined;
  try {
    responseBody = JSON.stringify(e);
  } catch {
    responseBody = undefined;
  }

  const message =
    typeof candidate['message'] === 'string'
      ? candidate['message']
      : typeof root['message'] === 'string'
        ? root['message']
        : `Provider returned HTTP ${statusCode}`;

  return {
    message,
    statusCode,
    isRetryable:
      statusCode === 429 || (statusCode >= 500 && statusCode < 600),
    responseBody,
  };
}
```

### Line-by-line

| Line | What it does | Why |
| --- | --- | --- |
| `if (!e \|\| typeof e !== 'object') return;` | Bail out for null/undefined/primitives. | Avoids `TypeError` from the property accesses below. A primitive thrown via `throw "some string"` is already handled by the later `e instanceof Error` branch and the final `default` branch. |
| `const root = e as Record<string, unknown>;` | Treat `e` as a plain object for safe dynamic key reads. | Provider-stream error parts are plain JSON objects, not class instances; `APICallError.isInstance(e)` already returned false in the preceding `case`. |
| `const candidate = root['error'] && typeof root['error'] === 'object' ? root['error'] : root;` | Descend into a nested `.error` field when present. | Provider-normalized shapes vary: OpenRouter sends `{ error: { code: 524, message: "..." } }`; some SDKs send `{ code: 429, message: "..." }` at the top level. Checking both is what lets a single predicate match both families. |
| `const rawCode = candidate['code'] ?? candidate['statusCode'] ?? candidate['status'];` | Try three common keys in priority order. | `code` is what OpenRouter / the OpenCode Zen wrapper used in PR #1833. `statusCode` is what `@ai-sdk/provider`'s `APICallError` uses. `status` is what `fetch` `Response` and some REST clients use. Matching any of the three keeps one normalizer useful across providers. |
| `typeof rawCode === 'number' ? ... : typeof rawCode === 'string' && /^\d+$/.test(rawCode) ? Number.parseInt(...)` | Accept numeric codes and purely numeric strings; reject anything else. | OpenAI-style bodies sometimes use string codes like `"rate_limit_exceeded"`. We do **not** want to coerce those into a numeric HTTP status — they require a completely different classification path (see `isModelNotSupportedError`). The regex gate also rejects negative, float, or mixed strings so we never fabricate a status. |
| `if (statusCode === undefined) return;` | Opt out cleanly. | Returning `undefined` causes the `case` predicate in `fromError` to be false, so control falls through to the existing `e instanceof Error` branches for socket/timeout classification. This is the safe escape hatch that prevents this new code from swallowing errors it should not own. |
| `try { responseBody = JSON.stringify(e); } catch { responseBody = undefined; }` | Capture the raw error shape as a string for the `APIError`. | `MessageV2.APIError.Schema` already carries an optional `responseBody` which is displayed in logs and the TUI. Downstream triage is much faster when the exact provider payload is visible. The `try/catch` guards against circular references on real `Error` objects whose `.cause` points back up the chain. |
| Message fallback ladder `candidate['message'] ?? root['message'] ?? "Provider returned HTTP ${statusCode}"` | Prefer the nested-error message, then the top-level message, then a synthesized one. | OpenRouter's `{error:{code,message}}` puts the human text under `candidate`. Some providers put it at the top level. The synthesized fallback guarantees a non-empty `APIError.data.message`, which `z.string()` requires in the schema and which `SessionStatus` renders in the UI. |
| `isRetryable: statusCode === 429 \|\| (statusCode >= 500 && statusCode < 600)` | Classify rate-limit and server-error statuses as retryable. | Matches both the AI SDK's own rule (`packages/provider/src/errors/api-call-error.ts`: `429 \|\| 5xx \|\| 408 \|\| 409`) and the informal agreement across provider SDKs. 524 (Cloudflare "A Timeout Occurred") and 502/503/504 are all caught; 400/401/404 are not. |

### What this case does not do

- It does not attempt to parse a status code out of error *messages* (e.g. "Request failed with status 524"). That lives in `isUsageDataTypeError` and `isModelNotSupportedError`, which are string-message predicates for different pathologies.
- It does not copy `responseHeaders`. Provider-stream error parts do not carry `Retry-After`, so `SessionRetry.delay` will fall through to its "headers present but no retry-after" branch for these errors and use the exponential backoff cap (`retry.ts:242-253`).
- It does not mutate the original `e`. The constructed `APIError` carries `e` as `cause`, preserving the full stack for diagnostics.

### What each piece prevents

- **Without the nested-`error` descent**, OpenRouter 524/429 responses become `UnknownError` and the retry gate skips them. We saw that exact failure in session 5.
- **Without the three-key `code/statusCode/status` fallback**, only one of the three shapes retries; the other two still look like UnknownError.
- **Without the numeric-string guard (`/^\d+$/`)**, string enum codes like `"rate_limit_exceeded"` would be coerced to `NaN` by a naïve `Number(...)` and slip past the `statusCode === undefined` gate, producing a bogus `APIError` with `NaN` statusCode.
- **Without the `isRetryable` rule**, every matched error would be silently retryable or silently non-retryable; the chosen rule mirrors the Vercel AI SDK's own `APICallError` semantics so behaviour is consistent with the rest of the codebase.

---

## 3. `isUsageDataTypeError` — line-by-line

**Location:** `js/src/session/processor.ts:65-87`. The call site is
`processor.ts:583-605`:

```ts
if (isUsageDataTypeError(e)) {
  log.warn(() => ({
    message: 'provider returned invalid usage data; retrying as provider API error',
    errorMessage: e instanceof Error ? e.message : String(e),
    providerID: input.providerID,
    issue: 'https://github.com/link-assistant/agent/issues/264',
  }));
  error = new MessageV2.APIError(
    {
      message: e instanceof Error ? e.message : 'Provider returned invalid usage data',
      isRetryable: true,
    },
    { cause: e }
  ).toObject();
}
```

The predicate:

```ts
export function isUsageDataTypeError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === 'string'
        ? error
        : '';

  if (!(error instanceof TypeError) && !message.startsWith('TypeError:')) {
    return false;
  }

  return [
    'input_tokens',
    'output_tokens',
    'usage.inputTokens',
    'usage.outputTokens',
    'inputTokens.total',
    'outputTokens.total',
    "reading 'inputTokens'",
    "reading 'outputTokens'",
  ].some((pattern) => message.includes(pattern));
}
```

### Line-by-line

| Lines | What it does | Why |
| --- | --- | --- |
| `const message = error instanceof Error ? ... : typeof error === 'string' ? error : '';` | Produce a single string to match against, regardless of whether the catch received a real `Error`, a string, or something weirder. | In Node the AI SDK throws `TypeError`. In Bun, some stack layers can rethrow the stringified form. Accepting both shapes makes the predicate portable across both runtimes the project supports. |
| `${error.name}: ${error.message}` | Prefix with the error name. | The fallback check below (`message.startsWith('TypeError:')`) uses this prefix so a stringified error rethrow still matches. |
| `if (!(error instanceof TypeError) && !message.startsWith('TypeError:')) return false;` | Narrow to `TypeError` only. | The AI SDK's usage-shape crash is strictly a `TypeError` from dereferencing undefined. Matching only this class avoids false positives (e.g. a provider returning the literal word `input_tokens` in a 400 message body). |
| `return [...].some(...)` over eight pattern strings | Match the exact message shapes emitted by different V8/JSC versions, camelCase vs snake_case adapters, and the v4 vs v5 AI SDK. | Message text varies by runtime: Bun's JSC says `undefined is not an object (evaluating 'usage.inputTokens.total')`; Node's V8 says `Cannot read properties of undefined (reading 'inputTokens')`. The eight patterns also cover adapters that use snake_case in the error message (some OpenAI-compatible providers). |

### Why we wrap it as `APIError` with `isRetryable: true`

The processor's retry gate only fires for `APIError.isRetryable`,
`SocketConnectionError.isRetryable` with `attempt < SOCKET_ERROR_MAX_RETRIES`,
or `TimeoutError.isRetryable` with `attempt < TIMEOUT_MAX_RETRIES`
(`processor.ts:608-617`). Wrapping as `APIError` plugs into the existing
retry-budget mechanism (`SessionRetry.shouldRetry` tied to
`LINK_ASSISTANT_AGENT_RETRY_TIMEOUT`) without adding yet another error class.
The delay schedule goes through `SessionRetry.delay(error, attempt)`
(`retry.ts:211-269`), which uses the "no response headers" branch
because we do not populate `responseHeaders` here — that branch caps the
delay at `RETRY_MAX_DELAY_NO_HEADERS` with exponential backoff and jitter,
which is the right behaviour for a server side that has already returned
and will not send a `Retry-After`.

`cause: e` preserves the original `TypeError` stack for debugging; the
`log.warn` line emits a structured record with `issue` pointing at
`#264` so the trace is easy to grep for in production logs.

### What this predicate does not do

- It does not inspect the stack. Stack-based matching is brittle across runtimes; message matching on eight patterns is narrower and easier to audit.
- It does not retry indefinitely. If the underlying provider truly never recovers, the normal `SessionRetry.shouldRetry` budget terminates the session with `RetryTimeoutExceededError` just like any other stuck 429/5xx.
- It does not paper over other TypeErrors. A `TypeError: Cannot read properties of undefined (reading 'foo')` that is not about token usage will not match any of the eight patterns and will still reach `MessageV2.fromError`'s `e instanceof Error` branch and become `UnknownError`, which is the correct behaviour.

---

## 4. Before / after execution trace for session 5

**Before PR #265:**

1. SSE stream completes with `{"error":{"code":524,"message":"Provider returned error"}}` and no `finish-step`.
2. AI SDK finalizer reads `usage.inputTokens.total`; throws `TypeError`.
3. `processor.ts` catch block runs `MessageV2.fromError(e, ...)`.
4. `fromError` checks `AbortError`, `TimeoutError`, `OutputLengthError`, `LoadAPIKeyError`, `APICallError.isInstance`. All false.
5. Falls into `e instanceof Error` branch; message contains "undefined is not an object (evaluating 'usage.inputTokens.total')"; does not contain "socket connection was closed" or "timed out". Returns `NamedError.Unknown`.
6. Retry gate: `error.name === 'APIError'` is false. Session exits with `hasError: true`.
7. Wrapper sees failure, stops auto-restart.

**After PR #265:**

1. Same SSE stream.
2. Same `TypeError`.
3. Catch block computes `error = MessageV2.fromError(e, ...)`. In the unlikely path where the caught value is the *plain error object* with `code: 524` rather than a TypeError, `normalizeProviderErrorObject` matches and returns a retryable `APIError` with `statusCode: 524`, `isRetryable: true`.
4. For the actual session-5 shape (TypeError), control continues to the `isUsageDataTypeError(e)` check at processor.ts:587. The predicate matches because the message contains `usage.inputTokens` and `inputTokens.total`. `error` is overwritten with a retryable `APIError`.
5. Retry gate sees `APIError.isRetryable === true`. `SessionRetry.shouldRetry` returns true. `SessionRetry.delay(error, attempt=1)` returns ~1 s + jitter.
6. The processor awaits the delay, increments `attempt`, and re-enters the `while(true)` top-level `try` with a fresh `stream = fn()`.
7. The next call either succeeds (transient 524 cleared) or fails the same way and uses another retry slot. If the retry budget runs out, `RetryTimeoutExceededError` propagates and the session fails cleanly, with the original provider error preserved in `cause` and a clear `APIError` shape for observability.

---

## 5. How other open-source AI agent CLIs handle the same problem

Research targets and what they do today (all links verified April 2026):

### sst/opencode (now anomalyco/opencode) — the upstream of this project

- Retry classifier: [`packages/opencode/src/session/retry.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/retry.ts).
  The predicate:

  ```ts
  if (MessageV2.APIError.isInstance(error)) {
    const status = error.data.statusCode
    if (!error.data.isRetryable && !(status !== undefined && status >= 500)) return undefined
  }
  ```

  It has a 5xx override that marks 5xx retryable even if the SDK didn't flag it, which is helpful — but it only fires when the error is already wrapped as `APIError`. Raw SSE error parts do not become `APIError` upstream, so a 524 like session 5 still falls through.

- Stream error: [`processor.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/processor.ts) has `case "error": throw value.error`, same pattern as this project. No explicit dereference-guard.

- Nested `error.code`: only parsed for rate-limit text sniffing (`json.error?.type === "too_many_requests"`, `json.error?.code` containing `"rate_limit"`). Not lifted into a numeric HTTP status.

- `TypeError` from usage: not handled upstream. A raw TypeError fails `APIError.isInstance` and ends up non-retryable — the exact pre-PR behaviour of this project.

**Takeaway:** `normalizeProviderErrorObject` and `isUsageDataTypeError` are
both strict improvements over the upstream behaviour. A port-back to
`anomalyco/opencode` would be welcome.

### google-gemini/gemini-cli

- Retry classifier: [`packages/core/src/utils/retry.ts`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/utils/retry.ts). The `isRetryableError` predicate walks the `.cause` chain up to 5 levels deep looking for network codes like `ECONNRESET` / `ETIMEDOUT`, and treats HTTP 429, 499, and 5xx as retryable. It does not descend into a JSON body's `.error.code` to lift a numeric HTTP status.

- `TypeError` from usage: not handled. Gemini's client is typed against the Google GenAI SDK which keeps usage metadata optional; there is no analog to the AI SDK's usage-shape crash path.

- Backoff: exponential with ±30% jitter, max 30 s; honors `Retry-After`. Comparable to this project's `SessionRetry.delay`.

**Takeaway:** gemini-cli takes the "walk cause chain for network codes" approach rather than the "parse a status out of an arbitrary nested JSON" approach. Different tactic, similar goal, but less tolerant of provider-specific error-object shapes.

### openai/codex (Rust)

- Stream retries: [`codex-rs/core/src/client.rs`](https://github.com/openai/codex/blob/main/codex-rs/core/src/client.rs). Config knobs `request_max_retries` (default 4) and `stream_max_retries` (default 5). 401 has a special refresh-token path. 429/5xx in-stream use exponential backoff with an error-body regex for `"Please try again in Ns"`; see [issue #4161](https://github.com/openai/codex/issues/4161).

- Nested `error.code`: limited. Parses provider rate-limit phrasing from the body but treats SSE errors as opaque `ApiError` and does not descend into nested JSON for a numeric HTTP code. Reported weak spot in [codex#2612](https://github.com/openai/codex/issues/2612) (OpenRouter 429 retry loop).

- `TypeError` / usage-object crash: N/A. Rust's `Option<Usage>` means missing usage is simply `None`; no class of bug exists.

**Takeaway:** codex-rs avoids the usage-shape crash entirely by being statically typed. The closest analog to `normalizeProviderErrorObject` is the `"Please try again in N"` body parser, which is narrower but philosophically similar: treat the body's structured fields as signal rather than discarding them as opaque.

### Vercel AI SDK (vercel/ai) — the library this code uses

- `APICallError.isRetryable`: [`packages/provider/src/errors/api-call-error.ts`](https://github.com/vercel/ai/blob/main/packages/provider/src/errors/api-call-error.ts):

  ```ts
  isRetryable = statusCode != null &&
    (statusCode === 408 ||
     statusCode === 409 ||
     statusCode === 429 ||
     statusCode >= 500);
  ```

  This is exactly the semantics this project's `normalizeProviderErrorObject` reproduces (minus 408/409, which we could add if we ever see provider streams emitting those in an error part — we have not observed this).

- Raw SSE `{error:{code,...}}` parts → `APICallError`: **not automatic**. The SDK's `streamText` only constructs an `APICallError` when the HTTP response itself fails, not when a successful HTTP 200 carries a JSON error part in-stream. This is the gap `normalizeProviderErrorObject` fills.

- Usage-shape TypeError: **known upstream bug**, [`vercel/ai#12477`](https://github.com/vercel/ai/issues/12477) — open, no linked PR. Suggested upstream fix is adding optional chaining: `response?.usage?.input_tokens ?? 0`. Until that ships, `isUsageDataTypeError` is the right defensive shim.

**Takeaway:** `isUsageDataTypeError` is a workaround for a confirmed SDK
defect. It stays in place until upstream adds the null check.
`normalizeProviderErrorObject` is complementary: it handles errors that
never reach the SDK's `APICallError` constructor.

### Comparison summary

| Concern | opencode (dev) | gemini-cli | codex (Rust) | Vercel AI SDK | **link-assistant/agent (this PR)** |
| --- | --- | --- | --- | --- | --- |
| 5xx SSE `{error:{code}}` → retryable APIError | No (dropped as non-APIError) | No (body not parsed for status) | Partial (text regex only) | No (needs pre-constructed APICallError) | **Yes** (`normalizeProviderErrorObject`) |
| 429 retryable | Yes (via SDK flag + text sniff) | Yes | Yes | Yes | Yes |
| 5xx override when SDK says `isRetryable=false` | Yes | Yes | Implicit | No | Yes |
| `TypeError` on `usage.inputTokens.total` | Not handled | Not handled | N/A (Rust) | **Open bug #12477** | **Yes** (`isUsageDataTypeError`) |
| Nested `.cause` / `.error.code` walk | Rate-limit only | `.cause` chain, 5 levels, network codes | Text regex on body | No | Yes, numeric code extraction |

### Why this PR is not redundant with existing retry logic

`SessionRetry.shouldRetry` and `SessionRetry.delay` already exist and
handle the *budget and pacing* side of retry correctly. What they cannot
do is *classify* a provider-stream error or a usage-shape TypeError as
retryable in the first place. The two new predicates move the right
errors into the classifier's retryable bucket; the existing retry
machinery then handles the rest. That separation keeps each layer small
and testable:

- `normalizeProviderErrorObject` has two corresponding test files: `js/tests/integration/stream-parse-error.test.js` (524 retry, 400 non-retry) and incidental coverage in `js/tests/model-not-supported.test.ts`.
- `isUsageDataTypeError` is unit-tested across Bun-style and Node-style messages in `js/tests/model-not-supported.test.ts`.

### Best-practice checklist against the comparison

- [x] Classify `HTTP 429 || 5xx` in provider-stream error parts as retryable — matches Vercel AI SDK's `APICallError` semantics.
- [x] Preserve original error as `cause` — debuggable stacks survive.
- [x] Emit a structured log line with an issue link — ops can grep for `issue-264` occurrences and track recurrence upstream.
- [x] Narrow the TypeError match to eight explicit patterns — avoids masking unrelated TypeErrors.
- [x] Use the existing retry budget rather than adding a parallel retry loop — no double-backoff, and `LINK_ASSISTANT_AGENT_RETRY_TIMEOUT` still bounds total wall time.
- [x] Route the synthetic `APIError` through the same `SessionRetry.delay` that real API errors use — consistent backoff and jitter.
- [ ] Port fixes upstream to `anomalyco/opencode` and link to `vercel/ai#12477` — see [`filed-issues.md`](filed-issues.md) for drafts.

---

## 6. References

- AI SDK error handling: <https://ai-sdk.dev/docs/ai-sdk-core/error-handling>
- AI SDK streamText reference (notes `inputTokens`/`outputTokens` can be undefined): <https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text>
- Vercel AI SDK `APICallError.isRetryable` source: <https://github.com/vercel/ai/blob/main/packages/provider/src/errors/api-call-error.ts>
- Open Vercel AI SDK bug (usage-shape TypeError): <https://github.com/vercel/ai/issues/12477>
- anomalyco/opencode retry classifier: <https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/retry.ts>
- anomalyco/opencode session processor: <https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/processor.ts>
- google-gemini/gemini-cli retry: <https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/utils/retry.ts>
- openai/codex Rust client: <https://github.com/openai/codex/blob/main/codex-rs/core/src/client.rs>
- openai/codex retry-after parsing issue: <https://github.com/openai/codex/issues/4161>
- openai/codex OpenRouter 429 retry loop issue: <https://github.com/openai/codex/issues/2612>
