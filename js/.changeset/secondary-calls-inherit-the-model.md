---
'@link-assistant/agent': patch
---

fix: session summaries and compaction follow `--model`

The compaction model is used for two secondary calls: context compaction, and the session summary that produces a title and description. Its shipped default names OpenCode models, because the shipped base model is an OpenCode one — so a run started with `--model formalai/formal-ai` still sent every summary request to `opencode/big-pickle` and collected a dozen HTTP 400s (`OpenCode's free tier can only be used in OpenCode`) in an otherwise successful log.

A compaction default nobody asked for now follows `--model`: when the configured model belongs to another provider, entries from other providers are dropped from the built-in cascade, falling back to the model running the turn. A compaction model named explicitly — on the command line or through `LINK_ASSISTANT_AGENT_DEFAULT_COMPACTION_MODEL(S)` — is still used exactly as written, and a run on the built-in provider keeps the built-in cascade with its rate-limit fallbacks.

A model can also declare that it has no context window to run out of, as `"limit": { "context": null }` or `"unlimited": true` in its provider config. Compaction, context diagnostics and session summarization are then skipped for it, so an integrator no longer has to pass `--no-summarize-session` on every run. The local diff stat is still recorded, because it costs no API call.

Closes #307
