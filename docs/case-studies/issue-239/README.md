# Case Study: Agent CLI Problems Preventing Task Completion

**Issue:** [#239](https://github.com/link-assistant/agent/issues/239)
**PR:** [#240](https://github.com/link-assistant/agent/pull/240)
**Date:** 2026-04-07
**Agent Version:** 0.20.0
**Solve Version:** 1.46.9
**Runtime:** Bun 1.3.11

## Problem Statement

During a solution draft session for [Jhon-Crow/godot-topdown-MVP#1763](https://github.com/Jhon-Crow/godot-topdown-MVP/pull/1763), the Agent CLI failed to complete the task. The session lasted only ~7 seconds and produced zero useful output despite the model executing tool calls (4 bash commands). Multiple distinct problems were identified.

## Raw Data

- **Full log:** [solution-draft-log.txt](./solution-draft-log.txt) (2715 lines)
- **Original gist:** [konard/14eb49ed72d093949b814034c0cf6be9](https://gist.github.com/konard/14eb49ed72d093949b814034c0cf6be9)

## Timeline of Events

| Time (UTC)         | Event                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------- |
| 17:24:00           | solve v1.46.9 starts, requests `--model opencode/minimax-m2.5-free`                     |
| 17:24:08           | Fork PR detected, continue mode activated for PR #1763                                  |
| 17:24:25           | Branch `issue-1762-c0f424e30cbb` checked out                                            |
| 17:24:34           | Agent CLI v0.20.0 invoked: `agent --model opencode/minimax-m2.5-free --verbose`         |
| 17:24:35.419       | **Problem 1:** Storage migration fails with ENOENT (null byte in path)                  |
| 17:24:35.423       | **Problem 2:** Model resolves to `qwen3.6-plus-free` instead of `minimax-m2.5-free`     |
| 17:24:35.434       | models.dev cache refreshed from https://models.dev/api.json                              |
| 17:24:35.580       | HTTP POST to opencode.ai/zen/v1/messages with `qwen3.6-plus-free` (wrong model)         |
| 17:24:41.349       | **Problem 3:** Provider returns zero tokens with unknown finish reason                   |
| 17:24:41.350       | Session cancelled, agent enters idle state                                               |
| 17:24:41.377       | Agent exits cleanly (exit code 0, uptime 7s)                                            |
| 17:24:41.474       | **Problem 4:** solve.mjs detects false positive error in verbose output                  |
| 17:24:41.715       | Failure logs attached to PR                                                              |

## Root Cause Analysis

### Problem 1: Storage Migration ENOENT with Null Byte in Path

**Error:**
```
ENOENT: no such file or directory, open '/workspace/.local/share/link-assistant-agent/project\0'
```

**Root Cause:** The storage migration system (index 0 in `MIGRATIONS` array) reads a file at `path.join(dir, 'project')`, but the file path contains a null byte (`\0`). This is a known issue with how Bun's `Bun.file()` API handles certain path constructions — specifically when joining paths that may contain trailing null bytes from buffer operations or incorrect string encoding.

**Location:** `js/src/storage/storage.ts:188`

**Impact:** Low — the migration failure is caught and logged as an error, and execution continues. However, it corrupts the migration index tracking, meaning migration 0 will be retried on every startup.

**Fix Proposal:** Sanitize the path by stripping null bytes before passing to `Bun.file()`:
```typescript
const migrationPath = path.join(dir, 'migration').replace(/\0/g, '');
```

Or ensure the `project` file path in migration 0 (`MIGRATIONS[0]`) properly validates the path before opening.

### Problem 2: Model Mismatch — CLI Argument Silently Ignored

**Requested:** `opencode/minimax-m2.5-free`
**Actually used:** `opencode/qwen3.6-plus-free` (the `DEFAULT_MODEL`)

**Root Cause:** The `getModelFromProcessArgv()` function in `js/src/cli/argv.ts` failed to extract `--model opencode/minimax-m2.5-free` from `process.argv`, returning `null`. When this returns null, `parseModelConfig()` falls through to the yargs-parsed `argv.model`, which returned the default value `opencode/qwen3.6-plus-free` instead of the user's CLI argument.

This is a **Bun/yargs compatibility issue**. When the agent is installed as a global Bun package and invoked via the `agent` binary wrapper, `process.argv` may have a different structure than expected:

- **Expected:** `['/path/to/bun', '/path/to/index.js', '--model', 'opencode/minimax-m2.5-free', '--verbose']`
- **Actual (Bun global):** May include extra entries like the binary name itself, shifting argument indices

This is consistent with [oven-sh/bun#22157](https://github.com/oven-sh/bun/issues/22157) — Bun includes extra arguments in `process.argv` for compiled/global binaries, breaking argument parsing libraries. The agent runs on Bun 1.3.11, and the log confirms the command was:
```
/workspace/.bun/bin/bun /workspace/.bun/install/global/node_modules/@link-assistant/agent/src/index.js --model opencode/minimax-m2.5-free --verbose
```

**Evidence:** No "model argument mismatch detected" warning appears in the log, confirming that `getModelFromProcessArgv()` returned `null` (the code path that would log the warning was never entered). Both `cliModelArg` (null) and `argv.model` (default) agreed — both were wrong.

**Impact:** Critical — the agent used a completely different model than requested, leading to unexpected behavior and potential task failure.

**Fix Proposal:**
1. Add a startup log that prints the raw `process.argv` for debugging model resolution
2. Add a validation step: if `argv.model` equals `DEFAULT_MODEL` but `process.argv` contains `--model`, log a critical warning
3. Consider using `Bun.argv` instead of `process.argv` for argument extraction in Bun environments
4. Fall back to scanning `Bun.argv` when `process.argv` parsing fails

**Workaround:** Use environment variables instead of CLI arguments:
```bash
export AGENT_MODEL=opencode/minimax-m2.5-free
agent --verbose
```

### Problem 3: Provider Returns Zero Tokens with Unknown Finish Reason

**Error:**
```json
{
  "finishReason": "unknown",
  "tokens": { "input": 0, "output": 0, "reasoning": 0 },
  "message": "Provider returned zero tokens with unknown finish reason..."
}
```

**Root Cause:** The OpenCode Zen proxy (opencode.ai/zen/v1/messages) returned a response where the model (`qwen/qwen3.6-plus-04-02:free` via OpenRouter) executed tool calls (4 bash commands) but reported zero tokens in the response metadata. The `finishReason` was set to `"unknown"` despite the model having completed its reasoning and tool calls.

**Evidence from the response body (line 2642):**
- The model successfully produced reasoning: *"Let me start by reading the issue details..."*
- The model executed 4 tool calls: `gh issue view`, `gh pr view`, `git branch`, `git status`
- All tool calls completed successfully with output
- But: `tokens: {input: 0, output: 0}` and `finish: "unknown"`

This suggests the OpenCode Zen proxy / OpenRouter did not properly propagate token usage and finish reason metadata from the underlying Qwen model.

**Impact:** Critical — the agent treated this as a fatal error and terminated the session, despite the model having actually done useful work. The tool results were thrown away.

**Fix Proposal:**
1. When the response contains successful tool calls but reports zero tokens, treat it as a recoverable condition — continue the session rather than terminating
2. Log a warning about the metadata mismatch but process the tool results
3. Report the issue to the OpenCode Zen / OpenRouter provider teams

### Problem 4: False Positive Error Detection in solve.mjs

**Error detected:**
```
❌ Agent reported error: [verbose] HTTP logging active for provider: opencode
```

**Root Cause:** The solve.mjs wrapper scans agent stdout for patterns matching error keywords. When `--verbose` mode is enabled, the agent outputs HTTP debugging information including the line `[verbose] HTTP logging active for provider: opencode`. The solve.mjs error detection regex matched "error" within "provider" or matched the verbose log format as an error pattern.

**Evidence (line 2694-2709):**
```json
{
  "type": "error",
  "exitCode": 0,
  "errorDetectedInOutput": true,
  "errorType": "AgentError",
  "errorMatch": "[verbose] HTTP logging active for provider: opencode"
}
```

Note that `exitCode: 0` — the agent exited cleanly. The "error" was entirely a false positive from output scanning.

**Impact:** Medium — causes solve.mjs to classify the run as failed and attach "failure logs" to the PR, even though the agent exited normally. This confuses the operator and masks the real problem (Problem 3).

**Fix Proposal:**
1. The error detection regex in solve.mjs should not match inside `[verbose]` prefixed lines
2. Or better: use structured JSON output parsing instead of regex-based error detection — check for `"type": "error"` or `"type": "session.error"` events rather than scanning for the word "error" in arbitrary output
3. When `exitCode === 0`, do not override with `errorDetectedInOutput: true` for verbose logging lines

## Interaction Between Problems

The problems form a causal chain:

```
Problem 2 (model mismatch)
    ↓ Agent sends request with wrong model (qwen3.6-plus-free instead of minimax-m2.5-free)
Problem 3 (zero tokens / unknown finish)
    ↓ Provider returns incomplete metadata for wrong model
    ↓ Agent terminates session despite successful tool calls
Problem 4 (false positive error)
    ↓ solve.mjs misclassifies verbose output as error
    ↓ Logs attached as "failure", masking root cause
```

Problem 1 (storage migration) is independent but adds noise to the log.

## Affected Components

| Component | Repository | Version | Problem |
| --------- | ---------- | ------- | ------- |
| Agent CLI | [link-assistant/agent](https://github.com/link-assistant/agent) | 0.20.0 | Problems 1, 2 |
| solve.mjs | [link-assistant/agent](https://github.com/link-assistant/agent) (or external) | 1.46.9 | Problem 4 |
| OpenCode Zen | [sst/opencode](https://github.com/sst/opencode) (proxy) | N/A | Problem 3 |
| Bun Runtime | [oven-sh/bun](https://github.com/oven-sh/bun) | 1.3.11 | Problem 2 (contributing factor) |
| yargs | [yargs/yargs](https://github.com/yargs/yargs) | N/A | Problem 2 (contributing factor) |

## Existing Related Issues

| Issue | Repository | Status | Relevance |
| ----- | ---------- | ------ | --------- |
| [#196](https://github.com/link-assistant/agent/issues/196) | link-assistant/agent | Closed | Same model mismatch + zero tokens pattern |
| [#198](https://github.com/link-assistant/agent/issues/198) | link-assistant/agent | Closed | Zero tokens with unknown finish reason |
| [#192](https://github.com/link-assistant/agent/issues/192) | link-assistant/agent | Closed | yargs caching/parsing mismatch |
| [#22157](https://github.com/oven-sh/bun/issues/22157) | oven-sh/bun | Open | Extra process.argv element in compiled binaries |
| [#1370](https://github.com/oven-sh/bun/issues/1370) | oven-sh/bun | Closed | Yargs compatibility with Bun |

## Proposed Solutions

### Immediate Fixes (Agent CLI)

1. **Add `process.argv` / `Bun.argv` diagnostic logging at startup** — always log the raw argv array when `--verbose` is enabled, to make model resolution debugging trivial.

2. **Harden `getModelFromProcessArgv()`** — also check `Bun.argv` if available, and log which source was used:
   ```typescript
   export function getModelFromProcessArgv(): string | null {
     // Try process.argv first
     let result = getArgFromProcessArgv('model', 'm');
     if (!result && typeof Bun !== 'undefined' && Bun.argv) {
       // Fallback to Bun.argv which may have different structure
       result = getArgFromBunArgv('model', 'm');
     }
     return result;
   }
   ```

3. **Don't terminate on zero tokens when tool calls succeeded** — in `js/src/session/prompt.ts`, check if the response contains completed tool calls before treating zero tokens as fatal:
   ```typescript
   if (tokens.input === 0 && tokens.output === 0 && finishReason === 'unknown') {
     if (response.parts?.some(p => p.type === 'tool' && p.state?.status === 'completed')) {
       log.warn(() => ({ message: 'zero tokens reported but tool calls succeeded, continuing' }));
       // Continue processing instead of erroring
     }
   }
   ```

4. **Sanitize storage paths** — strip null bytes from file paths in the storage module.

### External Reports Needed

1. **OpenCode Zen / sst/opencode** — Report that the Zen proxy returns `finish_reason: unknown` and zero token counts when the underlying model (qwen3.6-plus-free via OpenRouter) successfully executes tool calls.

2. **oven-sh/bun** — The existing issue [#22157](https://github.com/oven-sh/bun/issues/22157) covers compiled binaries; a comment or new issue may be needed for global installs via `bun install -g`.

## References

- [Bun process.argv documentation](https://bun.com/docs/guides/process/argv)
- [Bun.argv API reference](https://bun.com/reference/bun/argv)
- [oven-sh/bun#22157 — Extra argument in process.argv](https://github.com/oven-sh/bun/issues/22157)
- [oven-sh/bun#1370 — Yargs compatibility with Bun](https://github.com/oven-sh/bun/issues/1370)
- [yargs/yargs#2377 — Add support for Bun](https://github.com/yargs/yargs/issues/2377)
- [OpenCode Zen Documentation](https://opencode.ai/docs/zen/)
- [OpenCode Troubleshooting](https://opencode.ai/docs/troubleshooting/)
