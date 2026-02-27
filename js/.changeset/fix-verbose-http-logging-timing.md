---
'@link-assistant/agent': patch
---

fix: check verbose flag at HTTP call time, not SDK creation time (#206)

The verbose HTTP logging wrapper now checks `Flag.OPENCODE_VERBOSE` when each
HTTP request is made, instead of when the provider SDK is created. Previously,
the wrapper was conditionally installed at SDK creation time using
`if (Flag.OPENCODE_VERBOSE)`, which meant that if the SDK was cached before
the `--verbose` flag was processed by the CLI middleware, no HTTP logging would
occur for the entire session.

The fix always installs the fetch wrapper but makes it a no-op passthrough
(single boolean check) when verbose mode is disabled, ensuring zero overhead
in normal operation and reliable logging when `--verbose` is enabled.
