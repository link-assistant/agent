---
'@link-assistant/agent': patch
---

Refresh npm dependencies to their latest releases so the dependency-freshness check passes: the `ai` SDK and every `@ai-sdk/*` provider, `@agentclientprotocol/sdk`, `@modelcontextprotocol/sdk`, `@opencode-ai/sdk`, `@opentui/*` 0.8, `command-stream`, `hono`, `remeda`, `google-auth-library`, `glob` 14, `minimatch` 11 and the rest. `solid-js` is no longer pinned (opentui#689 is closed) and the obsolete `seroval` override is dropped because `solid-js` 1.9.18 already depends on a patched `seroval`. `lino-arguments` stays on 0.3.x: 0.4.0 throws "Ambiguous environment aliases" at startup when the environment holds both a lower- and upper-case spelling of one variable (for example `http_proxy` and `HTTP_PROXY`).
