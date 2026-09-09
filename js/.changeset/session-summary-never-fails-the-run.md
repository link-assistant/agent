---
'@link-assistant/agent': patch
---

fix: a failed session summary no longer fails the run

Session summarization is on by default, runs concurrently with the turn and is
never awaited, so a provider error during it had no rejection handler anywhere:
it surfaced as `unhandledRejection`, exited the process with status 1 and
aborted the still-streaming turn, which then emitted no `result` event.

`SessionSummary.summarize` now cannot reject — its body is guarded and the
failure is logged as a warning — the title `generateText` call carries the same
`.catch` the body-summary call already had, and both call sites mark the
fire-and-forget with `void` and a handler.

The same defect class is fixed one level up: `src/index.js` ended in a floating
`main();`, so the whole run lived in a promise nobody awaited. On Linux and
macOS the pending filesystem I/O of startup keeps Bun's event loop alive; on
Windows it does not — the loop drained mid-startup and the process exited 0
after printing its startup logs, without ever contacting the provider or
emitting a result. Awaiting `main()` keeps the process alive for as long as the
run takes.
