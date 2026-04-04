# Case Study: No HTTP Request/Response Logs in `--verbose` Mode (#227)

## Issue

When the agent CLI is used directly with `--verbose`, HTTP request/response logs appear correctly. However, when the agent is spawned by the `solve` command via the `command-stream` library, HTTP verbose logs are silently absent despite `--verbose` being passed.

**Issue:** https://github.com/link-assistant/agent/issues/227

## Evidence

### Working Case (Direct Invocation)

- **Log:** [Gist](https://gist.githubusercontent.com/konard/6a7107ae7987ef5ed19653d4b3b707cb/raw/2763388eac850465dc1a5ec1bb31f5001e9528f0/agent-cli-log.txt)
- **Command:** `echo "hi" | agent --verbose`
- **Version:** 0.18.3
- **Key indicators:**
  - `"verboseAtCreation": true` — Flag was true when SDK was created
  - 35 debug-level log entries
  - HTTP request/response logs present (e.g., `"message": "HTTP request"`)
  - `"message": "verbose HTTP logging active"` confirmation

### Broken Case (Subprocess via solve/command-stream)

- **Log:** [Gist](https://gist.githubusercontent.com/konard/79a96bcdf4b1e91ba83ba7bced26976c/raw/6a7f3b01e5a94d5a4bd00e94d1e50aae13c65c0e/solution-draft-log-pr-1775044356765.txt)
- **Command:** `cat prompt.txt | agent --model opencode/minimax-m2.5-free --verbose`
- **Version:** 0.18.1 (same code, different runtime environment)
- **Key indicators:**
  - `"verboseAtCreation": false` — Flag was false when SDK was created
  - 0 debug-level log entries
  - No HTTP request/response logs at all
  - `"globalVerboseFetchInstalled": true` — Middleware DID run
  - No `"message": "verbose HTTP logging active"` confirmation

## Timeline / Sequence of Events

1. **Solve command** spawns agent CLI as child process via command-stream
2. **Agent CLI starts** — yargs parses arguments, `--verbose` is recognized
3. **Middleware runs** — `Flag.setVerbose(true)` is called, `globalThis.fetch` is monkey-patched
4. **BUT** — `Flag.VERBOSE` is still `false` at the time HTTP calls are made
5. **Verbose-fetch wrapper** checks `Flag.VERBOSE` → finds it `false` → skips logging
6. **All HTTP logs are silently discarded**

## Root Cause Analysis

The `Flag.VERBOSE` flag is stored as an in-memory `export let` variable in the `flag.ts` module. When `setVerbose(true)` is called in the yargs middleware, it sets this variable to `true`. However, there's evidence that this value can be lost or not propagated correctly in certain runtime environments:

1. **Module re-evaluation:** Bun may re-evaluate modules in some circumstances, resetting the flag to its initial value (`false` from env var check)
2. **Runtime timing:** The flag may be checked before the middleware has fully completed in some environments
3. **No persistence mechanism:** The flag only exists in memory — if the module is reloaded, the flag reverts to its default

The evidence strongly supports this diagnosis:

- `globalVerboseFetchInstalled: true` proves the middleware ran
- `verboseAtCreation: false` proves the flag was `false` at SDK creation time
- 0 debug-level logs proves the flag was `false` during `Log.init()`
- These three facts together indicate the flag was set to `true` in the middleware but was `false` when checked later

## Solution

### 1. Remove Legacy OPENCODE\_\* Environment Variables

All `OPENCODE_*` environment variable support has been removed from the codebase. The codebase now uses exclusively `LINK_ASSISTANT_AGENT_*` prefixed environment variables. This is a clean break from the legacy naming.

### 2. Clean Flag Names

All `Flag.OPENCODE_*` export names have been renamed to clean names without the `OPENCODE_` prefix (e.g., `Flag.VERBOSE`, `Flag.DRY_RUN`, `Flag.CONFIG`), since they are already namespaced under `Flag`.

### 3. Environment Variable Propagation (Verbose Fix)

When `Flag.setVerbose(true)` is called, the environment variable `LINK_ASSISTANT_AGENT_VERBOSE=true` is now also set. This provides:

- **Persistence across module re-evaluations** — env vars survive module reloads
- **Child process inheritance** — subprocesses automatically inherit the flag
- **Redundancy** — two independent sources of truth

### 4. `Flag.isVerbose()` Method with Fallback (Resilience Fix)

A `Flag.isVerbose()` method checks both:

- The in-memory `VERBOSE` flag (fast path)
- The environment variable `LINK_ASSISTANT_AGENT_VERBOSE` (fallback)

All verbose checks across the codebase use `Flag.isVerbose()` instead of directly reading `Flag.VERBOSE`.

### Files Changed

| File                           | Change                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| `js/src/flag/flag.ts`          | Renamed exports, removed OPENCODE\_\* env vars, added `isVerbose()` and env var propagation |
| `js/src/util/verbose-fetch.ts` | Use `Flag.isVerbose()`                                                                      |
| `js/src/provider/provider.ts`  | Use `Flag.DRY_RUN`, `Flag.ENABLE_EXPERIMENTAL_MODELS`                                       |
| `js/src/config/config.ts`      | Use `Flag.CONFIG`, `Flag.CONFIG_DIR`, `Flag.CONFIG_CONTENT`                                 |
| `js/src/bun/index.ts`          | Use `Flag.DRY_RUN`                                                                          |
| `js/src/file/watcher.ts`       | Use `Flag.EXPERIMENTAL_WATCHER`                                                             |
| `js/src/session/compaction.ts` | Use `Flag.DISABLE_AUTOCOMPACT`, `Flag.DISABLE_PRUNE`                                        |
| `js/src/util/log.ts`           | Use `Flag.isVerbose()`                                                                      |
| `js/src/util/log-lazy.ts`      | Use `Flag.isVerbose()`                                                                      |
| `js/src/index.js`              | Use `Flag.DRY_RUN`, `Flag.isVerbose()`                                                      |
| `js/src/session/*.ts`          | Use `Flag.isVerbose()`                                                                      |
| `js/tests/`                    | Updated all tests to use new flag names and env var names                                   |

## Testing

### New Tests (`verbose-env-fallback.test.js`)

1. **Baseline:** `--verbose` flag produces HTTP logs
2. **Env var:** `LINK_ASSISTANT_AGENT_VERBOSE=true` enables HTTP logs without `--verbose` flag
3. **Negative:** No HTTP logs without `--verbose` or env var
4. **Propagation:** `verboseAtCreation: true` confirmed in subprocess

### Existing Tests

- `verbose-hi.test.js` — continues to pass (no regression)
- All dry-run, provider, and verbose logging tests updated and passing

## Evidence from Issue #229

Issue [#229](https://github.com/link-assistant/agent/issues/229) independently confirmed the same root cause with additional detail:

### Key Findings from #229

- **Working:** `OPENCODE_VERBOSE=true echo "hi" | agent --model opencode/minimax-m2.5-free` → `verboseAtCreation: true`, 18+ HTTP logs
- **Broken:** `echo "hi" | agent --model opencode/minimax-m2.5-free --verbose` (via command-stream) → `verboseAtCreation: false`, 0 HTTP logs
- **Critical observation:** `globalVerboseFetchInstalled: true` but `verboseAtCreation: false` — the interceptor was installed but the flag was not true when checked

### #229 Workaround (confirms root cause)

Setting both env vars AND CLI flag works:

```bash
OPENCODE_VERBOSE=true LINK_ASSISTANT_AGENT_VERBOSE=true echo "hi" | agent --verbose
```

This workaround was adopted in hive-mind's solve command ([link-assistant/hive-mind#1521](https://github.com/link-assistant/hive-mind/issues/1521)).

The fact that setting the env var fixes the problem while `--verbose` alone doesn't (in subprocess context) confirms that the in-memory flag set by yargs middleware is being lost, while the env var persists. This is the exact behavior our fix addresses: `setVerbose(true)` now also sets `LINK_ASSISTANT_AGENT_VERBOSE=true` in `process.env`, and `isVerbose()` checks the env var as fallback.

### Why yargs options alone are insufficient

The `--verbose` flag is processed by yargs middleware in `index.js`, which calls `Flag.setVerbose(true)`. However:

1. `Flag.VERBOSE` is an `export let` variable — a single in-memory binding
2. Many modules (`verbose-fetch.ts`, `log.ts`, `provider.ts`, etc.) import and check this flag independently at call time
3. In Bun's runtime, when modules are re-evaluated (e.g., during subprocess execution), the `export let` binding resets to its initial value
4. The initial value comes from `truthyEnv('LINK_ASSISTANT_AGENT_VERBOSE')` — if the env var isn't set, it defaults to `false`
5. Yargs options are only available in the CLI entry point (`index.js`), not in the deeper modules that check the flag

The env var propagation ensures the verbose state is available globally via `process.env`, which survives module re-evaluation and is accessible from any module without needing to thread yargs options through the entire call chain.

## Env Var Consistency

As part of this fix, all project-owned environment variables have been standardized to use the `LINK_ASSISTANT_AGENT_` prefix exclusively:

| Old Name                        | New Name                                             |
| ------------------------------- | ---------------------------------------------------- |
| `OPENCODE_VERBOSE`              | `LINK_ASSISTANT_AGENT_VERBOSE`                       |
| `OPENCODE_DRY_RUN`              | `LINK_ASSISTANT_AGENT_DRY_RUN`                       |
| `OPENCODE_CONFIG`               | `LINK_ASSISTANT_AGENT_CONFIG`                        |
| `VERIFY_IMAGES_AT_READ_TOOL`    | `LINK_ASSISTANT_AGENT_VERIFY_IMAGES_AT_READ_TOOL`    |
| `MCP_DEFAULT_TOOL_CALL_TIMEOUT` | `LINK_ASSISTANT_AGENT_MCP_DEFAULT_TOOL_CALL_TIMEOUT` |
| `MCP_MAX_TOOL_CALL_TIMEOUT`     | `LINK_ASSISTANT_AGENT_MCP_MAX_TOOL_CALL_TIMEOUT`     |
| `AGENT_CLI_COMPACT`             | `LINK_ASSISTANT_AGENT_COMPACT_JSON`                  |
| `AGENT_STREAM_CHUNK_TIMEOUT_MS` | `LINK_ASSISTANT_AGENT_STREAM_CHUNK_TIMEOUT_MS`       |
| `AGENT_STREAM_STEP_TIMEOUT_MS`  | `LINK_ASSISTANT_AGENT_STREAM_STEP_TIMEOUT_MS`        |

**Note:** Third-party env vars (`CLAUDE_CODE_OAUTH_TOKEN`, `AWS_*`, `GOOGLE_CLOUD_*`, `GEMINI_API_KEY`, etc.) are kept as-is since they are external interfaces defined by other tools/platforms.

## Architectural Improvement: Centralized Config with lino-arguments

### Problem

Before this fix, environment variables were read in multiple scattered locations:

- `flag.ts` — 15+ direct `process.env` reads with manual `truthyEnv()` helpers
- `mcp/index.ts` — 2 direct `process.env` reads for MCP timeouts
- `tool/read.ts` — 1 direct `process.env` read for image verification
- `index.js` — yargs middleware manually syncing CLI args to Flag module

This fragmentation made it hard to:

1. Know what configuration was resolved at startup
2. Debug configuration issues (no central log)
3. Support `.lenv` files or case-insensitive env vars

### Solution: lino-arguments

Adopted [lino-arguments](https://github.com/link-foundation/lino-arguments) to centralize env var resolution:

1. **`agent-config.ts`** — Single source of truth for all configuration. Uses `getenv()` from lino-arguments which provides case-insensitive lookups, type-preserving defaults, and `.lenv` file support.
2. **`flag.ts`** — Thin wrapper that reads from AgentConfig when initialized, falls back to env vars for backward compatibility.
3. **`index.js` middleware** — Calls `initAgentConfig(argv)` once after yargs parsing, merging CLI args and env vars in one place.
4. **Configuration logging** — Always logs the full resolved config as JSON at `info` level, critical for debugging.

### Configuration priority (highest to lowest)

1. CLI arguments (`--verbose`, `--dry-run`, etc.)
2. Environment variables (`LINK_ASSISTANT_AGENT_VERBOSE=true`)
3. `.lenv` file values (via lino-arguments)
4. Code defaults

### Key files

| File                          | Role                                                 |
| ----------------------------- | ---------------------------------------------------- |
| `js/src/flag/agent-config.ts` | Centralized config with getenv() from lino-arguments |
| `js/src/flag/flag.ts`         | Thin wrapper, reads from AgentConfig or env vars     |
| `js/src/index.js`             | Calls initAgentConfig(argv) in middleware            |
| `js/src/mcp/index.ts`         | Uses Flag.MCP\_\*() instead of direct process.env    |
| `js/src/tool/read.ts`         | Uses Flag.VERIFY_IMAGES_AT_READ_TOOL()               |

## Related Issues

- #229 — HTTP request/response logs missing when using `--verbose` CLI flag (env var works)
- #215 — Verbose HTTP logging infrastructure
- #217 — Provider-level HTTP logging
- #221 — Dual HTTP logging (global + provider)
- #206 — Call-time verbose flag checking
