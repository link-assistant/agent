---
'@link-assistant/agent': patch
---

Run bash tool commands through command-stream in the platform shell, with one AbortSignal for timeout and caller abort, process-tree cancellation (stopping the Windows process tree with taskkill until command-stream does), and live output streaming.
