---
'@link-assistant/agent': patch
---

Fix process name to show as 'agent' instead of 'bun' in process monitoring tools

This change sets both process.title and process.argv0 to 'agent' at CLI startup,
ensuring the process appears as 'agent' instead of 'bun' in monitoring tools like top and ps.
