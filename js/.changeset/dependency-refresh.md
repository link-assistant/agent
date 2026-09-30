---
'@link-assistant/agent': patch
---

Update JavaScript dependencies to current releases and migrate the local providers to AI SDK 7's Language Model V4 interface. Keep the two OpenTUI peer dependencies pinned to compatible versions until upstream supports their latest releases.

Allow npm registry propagation for five minutes and complete interrupted GitHub release steps for a version already published to npm.

Expose failed process exit codes in model-visible tool output and propagate tool errors through AI SDK provider requests, session history, batch calls, and stream-json. Preserve command metadata and fix completion of commands cancelled before execution begins.

Refresh vulnerable transitive brace-expansion and ip-address versions in the npm lockfile, and brace-expansion in the Bun lockfile.
