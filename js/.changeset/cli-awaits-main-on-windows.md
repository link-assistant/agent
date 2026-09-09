---
'@link-assistant/agent': patch
---

fix: the CLI no longer exits without running the turn on Windows

`src/index.js` ended in a floating `main();`, so the whole run lived in a
promise nobody awaited. On Linux and macOS the pending filesystem I/O of
startup keeps Bun's event loop alive; on Windows it does not — the loop drained
mid-startup and the process exited 0 after printing its startup logs, without
ever contacting the provider or emitting a result. Awaiting `main()` keeps the
process alive for as long as the run takes.
