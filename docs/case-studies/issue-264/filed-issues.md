# Upstream Issue Drafts for Case Study #264

This file tracks upstream issues that should be filed for problems surfaced
during the investigation of PR #1833. Each draft contains a reproducible
example, the observed workaround in Agent CLI, and a suggested fix in code so
the upstream maintainer can act without re-doing the analysis.

The drafts are kept in the repository so that they can be filed by a human
reviewer with the correct external account, and so subsequent PRs in the
`link-assistant/agent` repository can link to them.

## 1. Vercel AI SDK — `usage.inputTokens.total` TypeError when provider stream errors before finish-step

- Repository: https://github.com/vercel/ai
- Affected packages observed in logs: `ai` v6, `@ai-sdk/openai-compatible`.
- Evidence: `logs/solution-draft-log-pr-1776272637847.txt:52558-52583`.

### Title

`streamText` crashes with `TypeError: undefined is not an object (evaluating 'usage.inputTokens.total')` when provider stream emits an `error` part before `finish-step`

### Summary

When a provider emits an `error` stream part carrying an HTTP-like status code
(for example OpenRouter `524 Provider returned error`) before a valid
`finish-step` event, the AI SDK's internal usage accumulator reads
`usage.inputTokens.total` on an undefined usage object. That turns a
transient provider failure into a local `TypeError` that consumers see
instead of the real provider error, so retry/backoff logic cannot act on it.

### Reproducible Example

```ts
import { streamText } from 'ai';

// Mock provider that emits a provider error part and then ends the stream
// without a finish-step event. This mirrors the OpenRouter `524` case.
const mockProvider = {
  async doStream() {
    return {
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: 'error',
            error: {
              code: 524,
              message: 'Provider returned error',
              metadata: { error_type: 'unmapped' },
            },
          });
          controller.close();
        },
      }),
      rawResponse: { headers: new Headers() },
    };
  },
};

const result = streamText({
  model: mockProvider as any,
  prompt: 'hello',
});

for await (const part of result.fullStream) {
  // TypeError here instead of the `error` part being surfaced.
}
```

### Observed Workaround In `link-assistant/agent`

- `js/src/session/processor.ts` — `isUsageDataTypeError` detects the exact
  message and retries as a provider API error.
- `js/src/session/message-v2.ts` — `normalizeProviderErrorObject` unwraps
  provider error objects that contain `code`/`statusCode`/`status` and
  produces an `APIError` with `isRetryable` based on `429` or `5xx`.

### Suggested Upstream Fix

When the SDK consumes a stream that ends without a successful finish-step,
it should either propagate the provider `error` part unchanged or throw an
`APICallError`-shaped error instead of crashing while reading usage fields.
Concretely: guard the usage accumulator with `usage?.inputTokens?.total`
(or equivalent) before dereferencing, and in the final-error path re-throw
the provider error rather than the usage read failure.

## 2. Vercel AI SDK — Documented handling of provider `error` stream parts with HTTP-like codes

- Repository: https://github.com/vercel/ai
- Evidence: same error stream fragment above; same `data/external-pr-1833-issue-comments.json`.

### Title

`streamText` should classify provider stream `error` parts with numeric `code` or `statusCode` as retryable API errors

### Summary

The AI SDK currently treats `error` stream parts as opaque. Any retry
classification has to be re-implemented by each consumer. Consumers then
need to re-derive `isRetryable` from `code`/`statusCode`/`status` fields
that OpenRouter, Anthropic, Azure, and other providers format differently.

### Reproducible Example

```ts
// Same stream as in issue #1 above.
// The consumer must inspect `part.error.code` and map to 5xx/429 itself.
```

### Observed Workaround In `link-assistant/agent`

- `js/src/session/message-v2.ts` — `normalizeProviderErrorObject` handles
  flat and nested `error` objects, numeric and string status codes, and
  classifies `429` and `5xx` as retryable.

### Suggested Upstream Fix

Export a small helper (for example `providerErrorFromStream`) that accepts
the `error` stream part and returns an `APICallError` with the correct
`statusCode`, `isRetryable`, and `responseBody`. Recommend it in
`docs/ai-sdk-core/error-handling` so consumers converge on the same
classification. At minimum, document the expected shapes for provider
error parts so downstream retry logic can be implemented consistently.

## 3. Agent CLI internal — Deterministic dirty-tree finalizer on auto-restart

- Repository: https://github.com/link-assistant/agent
- Status: documented in `README.md` under "Recommended Follow-Up Plan".

### Summary

The initial push to the PR branch succeeded, but the dirty-tree recovery
path depended entirely on the model voluntarily emitting a `git commit`
tool call. When the model produced malformed tool-call marker text
instead, the file stayed uncommitted across three auto-restart iterations
and through the final failure. This is the orchestration-level root
cause observed in PR #1833.

### Suggested Agent CLI Fix (follow-up PR)

1. On auto-restart, run `git status --porcelain`, `git diff --check`,
   `git add`, `git commit`, and `git push` from a deterministic controller
   path when the change set matches the active task or a known cleanup
   fallback — before handing control back to the model.
2. Log `pwd`, `git rev-parse --show-toplevel`, and the failing git command
   when any `git` shell-out fails, so future diagnostics do not need the
   operator to attach raw tmp logs.
3. Fail loudly if the working tree is dirty at PR finalization time.
   Include `git status` and diffstat in the failure comment instead of
   starting another unconstrained model session.

This follow-up is intentionally out of scope for this PR because it
requires controller changes beyond error classification.
