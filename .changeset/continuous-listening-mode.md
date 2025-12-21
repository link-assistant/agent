---
'@link-assistant/agent': minor
---

feat: Enable continuous listening mode by default

- Add `--always-accept-stdin` flag (default: true) for continuous input mode
- Add `--compact-json` flag for machine-to-machine communication
- Pretty-print status messages to stderr by default
- Keep session alive between messages for multi-turn conversations
- Handle SIGINT gracefully for clean shutdown
