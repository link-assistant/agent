---
'@link-assistant/agent': patch
---

fix: resolve incorrect peer dependency warning for ai@6.0.86

- Update @openrouter/ai-sdk-provider from ^1.5.4 to ^2.2.3 (supports AI SDK v6)
- Update @opentui/core from ^0.1.46 to ^0.1.79
- Update @opentui/solid from ^0.1.46 to ^0.1.79

This fixes the `warn: incorrect peer dependency "ai@6.0.86"` warning that
appeared during `bun install` because @openrouter/ai-sdk-provider@1.x
required ai@^5.0.0 while we use ai@^6.0.1.

Note: The `solid-js` peer dependency warning remains due to an upstream
issue in @opentui/solid which uses exact version pinning. This has been
reported at https://github.com/anomalyco/opentui/issues/689

Fixes #186
