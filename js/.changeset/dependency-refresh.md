---
'@link-assistant/agent': patch
---

Update JavaScript dependencies to current releases and migrate the local providers to AI SDK 7's Language Model V4 interface. Keep the two OpenTUI peer dependencies pinned to compatible versions until upstream supports their latest releases.

Allow npm registry propagation for five minutes and complete interrupted GitHub release steps for a version already published to npm.

Prepare the bash parser for web-tree-sitter's renamed WASM export and verify permission enforcement with 0.25.10 and 0.27.0 in packed-package tests. Keep the 0.25.10 dependency pin until OpenTUI supports the current runtime (Agent #322).
