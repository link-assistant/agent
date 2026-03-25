---
'@link-assistant/agent': patch
---

feat: improve verbose HTTP logging reliability (#215)

- Add diagnostic breadcrumb log ("verbose HTTP logging active") on first HTTP call per provider to confirm the fetch wrapper is in the chain
- Pass Bun's non-standard `verbose: true` option to fetch() when verbose mode is enabled, enabling detailed connection debugging for socket errors
- Include stack trace and error.cause in HTTP request failed log entries for better debugging of connection failures
- Add case study documenting the "socket connection closed unexpectedly" error analysis
