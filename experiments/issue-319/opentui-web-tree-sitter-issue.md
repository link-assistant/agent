## Summary

`@opentui/core@0.5.12` still requires the exact `web-tree-sitter@0.25.10` peer, while `web-tree-sitter@0.27.0` is current. This blocks the standing requirement in #319 to keep all direct Agent dependencies at their latest releases.

## Reproduction

1. Add `@opentui/core@0.5.12` and `web-tree-sitter@0.27.0` as dependencies of a package.
2. Pack it and install it in a fresh Bun project.

The install reports `warn: incorrect peer dependency "web-tree-sitter@0.27.0"`. `npm ls web-tree-sitter --all` also exits with `ELSPROBLEMS` because the peer is exactly `0.25.10`.

The incompatibility is functional: the OpenTUI worker imports `web-tree-sitter/tree-sitter.wasm`, which was renamed in 0.26. The upstream maintainer [confirmed that 0.26+ is unsupported](https://github.com/anomalyco/opentui/issues/1201#issuecomment-4806912949).

Agent itself also uses the old WASM path in `js/src/tool/bash.ts`. Until OpenTUI supports the newer API and Agent adapts its parser, Agent must pin `web-tree-sitter@0.25.10` and link this issue in its dependency freshness exception.

## Done when

- OpenTUI supports the current `web-tree-sitter` release.
- Agent's bash parser loads the current WASM asset and passes its bash tool tests.
- The packed Agent package installs without peer warnings, and the direct pin can be upgraded to the latest version.
