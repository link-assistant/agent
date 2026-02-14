---
'@link-assistant/agent': patch
---

fix: Skip malformed SSE events instead of crashing (AI_JSONParseError)

When AI gateways (e.g. OpenCode Zen) corrupt SSE stream chunks when proxying
provider responses (e.g. Kimi K2.5), the Vercel AI SDK emits an error event
with AI_JSONParseError but continues the stream. Previously, the processor
threw on all error events, terminating the session.

Now, following the OpenAI Codex approach (skip-and-continue), the processor
detects JSONParseError in stream error events, logs a warning, and continues
processing subsequent valid chunks. This prevents a single corrupted SSE event
from terminating an entire session.

- Skip JSONParseError in processor.ts stream error handler (Codex approach)
- Remove StreamParseError retry infrastructure (skip, don't retry)
- Add case study with comparison of 4 CLI agents (Codex, Gemini, Qwen, OpenCode)
- Filed upstream issues: vercel/ai#12595, anomalyco/opencode#13579

Fixes #169
