---
'@link-assistant/agent': patch
---

fix: prevent agent process leaks with lifetime watchdog and event loop fixes (#213)

- Add AGENT_PROCESS_LIFETIME_TIMEOUT env var to force-exit processes exceeding a configurable maximum lifetime
- Fix setTimeout in continuous-mode.js waitForPending to use .unref() so it doesn't prevent process exit
- Use process.once('SIGINT') instead of process.on('SIGINT') to prevent handler accumulation
- Fix missing error listener removal in input-queue.js stop()
- Add process lifecycle exit logging for debugging
