# Case Study: Issue #332 — a recoverable tool failure emitted as a fatal `error` event

- Issue: https://github.com/link-assistant/agent/issues/332
- Hive Mind side: link-assistant/hive-mind#3213 (umbrella link-assistant/hive-mind#3215)
- Affected version: `@link-assistant/agent` 0.26.13

## Timeline (2026-10-13, Hive Mind 2.35.8, `--model formal-ai`)

1. The model called `read` on `/tmp/gh-issue-solver-…/e.g`, a path that does
   not exist (the path itself came from link-assistant/formal-ai#1189).
2. The `read` tool threw `Error: File not found: …/e.g`. The session processor
   stored it on the tool part (`state.status: "error"`) and sent it to the model
   as the tool result, so the model could continue. It did: the next step
   answered with text and finished with `reason: "stop"`, and the agent exited 0.
3. The CLI emitted two events for that one tool part: the `tool_use` event, and
   a top-level `{"type":"error", "part": {…}, "message": "Error: File not
found: …/e.g"}` event on stderr.
4. Hive Mind treats any top-level `error` event as fatal (link-assistant/hive-mind#1201
   logic): _"Agent exited 0 after an error event; the error event in its output
   still fails the run"_, and reported
   `AGENT execution failed with Agent reported error: Error: File not found: …/e.g`.

## Root cause

`js/src/cli/event-handler.js` (`outputBusEvent`), for every
`message.part.updated` tool part:

```js
eventHandler.output({ type: 'tool_use', timestamp, sessionID, part });
// If tool failed, also output an error event
if (part.state?.status === 'error') {
  eventHandler.output({
    type: 'error',
    timestamp,
    sessionID,
    part,
    message,
    error,
  });
}
```

The `tool_use` event already carries `part.state.status: "error"` and the error
text, so the second event added no information. It only re-labelled a
recoverable tool result with the type used for fatal session errors
(`session.error` → `error`). Consumers had no way to tell the two apart.

The Claude `stream-json` adapter depended on that duplicate event: it turned the
`error` event back into the terminal `tool_result` with `status: "error"`.
Because the source event was an `error`, that `tool_result` was also written
to **stderr** instead of stdout.

## Fix

- `outputBusEvent` reports a failed tool call only on its `tool_use` event.
  Top-level `error` events now come only from `session.error` and the
  CLI-level failure paths, which are failures that end the turn or session.
- The Claude adapter builds the error `tool_result` straight from the
  `tool_use` snapshot (`state.status === "error"`), rendering the error with
  `errorText(state.error, 'Tool execution failed')`. It now goes to stdout.
- The contract is documented in [`docs/stdin-mode.md`](../../stdin-mode.md#error-events).

Of the options listed in the issue, this one was chosen over a new
`tool_error` type or a `recoverable: true` flag: the information is already on
the `tool_use` event, and a separate event would be one more type for consumers
to classify. Consumers that need tool failures can read `part.state.status`.

## Verification

- `js/tests/recoverable-tool-error.ts` runs the real CLI against a local
  OpenAI-compatible mock. The first turn calls `read` on a missing file and the
  follow-up turn answers with text. For both JSON standards the test asserts
  that the model received `File not found`, that the failure appears on the
  tool's own event, that the run exits 0, and that the stream contains no
  `error` event. Before the fix, both tests failed with exactly the event from
  the incident.
- `js/tests/event-handler.js` has unit tests for the event handler: a failed
  tool part yields only `tool_use` and does not call `onError`, a
  `session.error` is still a fatal `error`, and the Claude error `tool_result`
  goes to stdout, renders object errors and falls back to
  `Tool execution failed`.
