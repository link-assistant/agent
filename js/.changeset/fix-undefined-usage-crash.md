---
'@link-assistant/agent': patch
---

Fix crash when providers return undefined usage data. Handle AI SDK TypeError for input_tokens gracefully and upgrade AI SDK to v6.0.1 which includes upstream fix. Also ensure unhandled rejections exit with code 1 instead of code 0.
