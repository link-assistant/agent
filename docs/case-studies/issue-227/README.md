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
4. **BUT** — `Flag.OPENCODE_VERBOSE` is still `false` at the time HTTP calls are made
5. **Verbose-fetch wrapper** checks `Flag.OPENCODE_VERBOSE` → finds it `false` → skips logging
6. **All HTTP logs are silently discarded**

## Root Cause Analysis

The `Flag.OPENCODE_VERBOSE` flag is stored as an in-memory `export let` variable in the `flag.ts` module. When `setVerbose(true)` is called in the yargs middleware, it sets this variable to `true`. However, there's evidence that this value can be lost or not propagated correctly in certain runtime environments:

1. **Module re-evaluation:** Bun may re-evaluate modules in some circumstances, resetting the flag to its initial value (`false` from env var check)
2. **Runtime timing:** The flag may be checked before the middleware has fully completed in some environments
3. **No persistence mechanism:** The flag only exists in memory — if the module is reloaded, the flag reverts to its default

The evidence strongly supports this diagnosis:
- `globalVerboseFetchInstalled: true` proves the middleware ran
- `verboseAtCreation: false` proves the flag was `false` at SDK creation time
- 0 debug-level logs proves the flag was `false` during `Log.init()`
- These three facts together indicate the flag was set to `true` in the middleware but was `false` when checked later

## Solution

### 1. Environment Variable Propagation (Primary Fix)

When `Flag.setVerbose(true)` is called, the environment variable `LINK_ASSISTANT_AGENT_VERBOSE=true` is now also set. This provides:
- **Persistence across module re-evaluations** — env vars survive module reloads
- **Child process inheritance** — subprocesses automatically inherit the flag
- **Redundancy** — two independent sources of truth

### 2. `Flag.isVerbose()` Method with Fallback (Resilience Fix)

A new `Flag.isVerbose()` method checks both:
- The in-memory `OPENCODE_VERBOSE` flag (fast path)
- The environment variables `LINK_ASSISTANT_AGENT_VERBOSE` / `OPENCODE_VERBOSE` (fallback)

All verbose checks across the codebase now use `Flag.isVerbose()` instead of directly reading `Flag.OPENCODE_VERBOSE`.

### Files Changed

| File | Change |
|------|--------|
| `js/src/flag/flag.ts` | Added `isVerbose()` method and env var propagation in `setVerbose()` |
| `js/src/util/verbose-fetch.ts` | Use `Flag.isVerbose()` instead of `Flag.OPENCODE_VERBOSE` |
| `js/src/provider/provider.ts` | Use `Flag.isVerbose()` |
| `js/src/util/log.ts` | Use `Flag.isVerbose()` in `init()` and `syncWithVerboseFlag()` |
| `js/src/util/log-lazy.ts` | Use `Flag.isVerbose()` |
| `js/src/index.js` | Use `Flag.isVerbose()` in middleware |
| `js/src/session/*.ts` | Use `Flag.isVerbose()` across session modules |
| `js/tests/integration/verbose-env-fallback.test.js` | New test for env var fallback |

## Testing

### New Tests (`verbose-env-fallback.test.js`)
1. **Baseline:** `--verbose` flag produces HTTP logs
2. **Env var:** `LINK_ASSISTANT_AGENT_VERBOSE=true` enables HTTP logs without `--verbose` flag
3. **Negative:** No HTTP logs without `--verbose` or env var
4. **Propagation:** `verboseAtCreation: true` confirmed in subprocess

### Existing Tests
- `verbose-hi.test.js` — continues to pass (no regression)

## Related Issues
- #215 — Verbose HTTP logging infrastructure
- #217 — Provider-level HTTP logging
- #221 — Dual HTTP logging (global + provider)
- #206 — Call-time verbose flag checking
