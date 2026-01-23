---
'@link-assistant/agent': patch
---

Fix CLI output streams to follow Unix conventions

- Route normal output (status, events, data, logs, warnings) to stdout
- Route error messages only to stderr
- Add `type` field to all JSON output for easy parsing
- Support `--compact-json` flag and `AGENT_CLI_COMPACT` env var for NDJSON format
- Flatten log format from `{ "log": { ... } }` to `{ "type": "log", ... }`
