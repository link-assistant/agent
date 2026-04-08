---
'@link-assistant/agent': patch
---

fix: verbose log messages no longer emitted as "type": "error" events (#235)

- `provider.ts`: replace `process.stderr.write()` with `log.debug()` for verbose HTTP logging diagnostic breadcrumb
- `verbose-fetch.ts`: exit handler writes proper JSON instead of plain text `[verbose]` prefix
- `index.js`: stderr interceptor wraps `[verbose]`/`[debug]` prefixed messages as `"type": "log"` instead of `"type": "error"`
