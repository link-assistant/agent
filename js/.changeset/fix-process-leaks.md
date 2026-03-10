---
'@link-assistant/agent': patch
---

fix: prevent agent process leaks with event loop fixes and ESLint rules (#213)

- Fix setTimeout/setInterval in retry-fetch.ts, session/retry.ts, and util/timeout.ts to use .unref() so timers don't prevent process exit
- Fix Bun.serve() idleTimeout from 0 (infinite) to 255 (default) to prevent keeping event loop alive
- Fix setTimeout in continuous-mode.js waitForPending to use .unref()
- Use process.once('SIGINT') instead of process.on('SIGINT') to prevent handler accumulation
- Fix missing error listener removal in input-queue.js stop()
- Add eslint-plugin-promise for detecting dangling/floating promises
- Add no-restricted-syntax ESLint rules to warn on process.on('SIGINT'/'SIGTERM') — prefer process.once()
- Remove AGENT_PROCESS_LIFETIME_TIMEOUT (agents can run for hours, global timeout is not appropriate)
- Add --retry-on-rate-limits flag (use --no-retry-on-rate-limits to disable AI API rate limit retries)
- Move integration tests to tests/integration/ to prevent bulk running; default bun test runs only unit tests
