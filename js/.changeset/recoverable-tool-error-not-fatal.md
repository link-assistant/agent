---
'@link-assistant/agent': patch
---

fix: a failed tool call is no longer emitted as a fatal top-level `error` event

A tool call that fails (a missing file, a bad edit anchor, a non-zero `bash`
exit) is a normal tool result that the model recovers from, but the CLI also
emitted it as a top-level `{"type":"error"}` event, the type reserved for
failures that end the turn or session. Consumers such as Hive Mind treat that
event as fatal, so one recoverable tool error failed the whole run.

A failed tool call is now reported only on its own event: `tool_use` with
`part.state.status: "error"` in OpenCode output, and a `tool_result` with
`status: "error"` on stdout in Claude `stream-json` output. `error` events are
emitted only for session- or turn-ending failures. The contract is documented
in `docs/stdin-mode.md` (#332).
