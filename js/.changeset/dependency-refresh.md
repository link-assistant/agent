---
'@link-assistant/agent': patch
---

Update JavaScript dependencies to current releases and migrate the local providers to AI SDK 7's Language Model V4 interface. Keep the two OpenTUI peer dependencies pinned to compatible versions until upstream supports their latest releases.

Allow npm registry propagation for five minutes and complete interrupted GitHub release steps for a version already published to npm.

Expose failed process exit codes in model-visible tool output and propagate tool errors through AI SDK provider requests, session history, batch calls, and stream-json. Preserve command metadata and fix completion of commands cancelled before execution begins.

Prepare the bash parser for web-tree-sitter's renamed WASM export and verify permission enforcement with 0.25.10 and 0.27.0 in packed-package tests. Keep the 0.25.10 dependency pin until OpenTUI supports the current runtime (Agent #322).

Refresh OpenTUI to 0.5.13 and the other newly released direct patches, including both lockfiles' patched brace-expansion and ip-address resolutions.
