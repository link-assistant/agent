---
'@link-assistant/agent': minor
---

feat: Implement JSON lazy logging with log-lazy library

- Added `log-lazy` dependency from link-foundation for lazy evaluation pattern
- Created `src/util/log-lazy.ts` module for standalone lazy logging with JSON output
- Updated `src/util/log.ts` to support lazy logging with `lazy.{debug,info,warn,error}` methods
- JSON output wraps all logs in `{ log: { ... } }` structure for easy parsing
- Logs are written to stderr to avoid mixing with stdout JSON data
- Lazy evaluation prevents expensive string formatting and object serialization when logging is disabled
- Converted existing log calls across the codebase to use lazy pattern for improved performance:
  - Session management files (agent.js, compaction.ts, processor.ts, prompt.ts, revert.ts, summary.ts)
  - Authentication (claude-oauth.ts, plugins.ts)
  - Provider and model handling (provider.ts, models.ts)
  - Configuration loading (config.ts)
  - File operations (watcher.ts, ripgrep.ts, time.ts)
  - MCP client handling (mcp/index.ts)
  - Server routing (server.ts)
  - Formatting, patching, and project state management
- Added comprehensive tests in tests/log-lazy.test.js

Closes #81
