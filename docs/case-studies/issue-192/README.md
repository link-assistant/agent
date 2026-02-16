# Case Study: Issue #192 - Model Substitution Bug

## Summary

When a user requested `--model kilo/glm-5-free` through the `solve` CLI tool, the @link-assistant/agent system incorrectly used `opencode/kimi-k2.5-free` instead. This is a recurrence of the same issue documented in Issues #165, #171, and #173, despite fixes being merged.

## Issue Details

- **Issue URL**: https://github.com/link-assistant/agent/issues/192
- **Reporter**: konard
- **Date**: 2026-02-16
- **Agent Version**: 0.16.3
- **Related Issues**: #165 (original bug), #166 (fix PR), #171 (deep investigation), #173 (follow-up)
- **Severity**: Critical - Users cannot reliably use Kilo Gateway models

## Timeline of Events

| Timestamp (UTC) | Event |
|-----------------|-------|
| 2026-02-16T10:12:04.336Z | User executed: `solve https://github.com/Jhon-Crow/godot-topdown-MVP/pull/780 --tool agent --model kilo/glm-5-free` |
| 2026-02-16T10:12:30.033Z | Solve script logs: `Model: kilo/glm-5-free` |
| 2026-02-16T10:12:30.082Z | Raw command to agent: `agent --model kilo/glm-5-free --verbose` |
| 2026-02-16T10:12:30.649Z | Agent v0.16.3 starts, command shows `--model kilo/glm-5-free` |
| 2026-02-16T10:12:30.692Z | **BUG**: `rawModel: "opencode/kimi-k2.5-free"` logged (wrong model) |
| 2026-02-16T10:12:30.731Z | Config files loaded from `/home/hive/.config/link-assistant-agent/` |
| 2026-02-16T10:12:30.824Z | Provider state: opencode, kilo, claude-oauth all found |
| 2026-02-16T10:12:30.839Z | `getModel` called with `providerID: "opencode"`, `modelID: "kimi-k2.5-free"` |
| ~10:12:42Z onwards | Agent execution proceeds with wrong model |

## Root Cause Analysis

### Key Evidence

1. **Command line was correct**: The `solve` script correctly passed `--model kilo/glm-5-free`
2. **Agent received correct command**: Log shows `command: "... --model kilo/glm-5-free --verbose"`
3. **argv.model was wrong**: Only 43ms later, `rawModel` shows `opencode/kimi-k2.5-free`
4. **Config loaded AFTER the wrong model was logged**: Config files loaded at timestamp `.731Z` but model was wrong at `.692Z`

### Possible Root Causes

#### 1. Bun Runtime Cache Issue (Most Likely)

The Bun JavaScript runtime may be caching an older version of the agent code despite the correct version being installed. Evidence:

- PR #166 was merged on 2026-02-13 to fix this exact issue
- Issue #171 and #173 were opened and closed, both showing the fix working
- The installed version (0.16.3) includes the fix
- But behavior on the production server still shows the old bug

**Workaround**: Run `bun pm cache rm` and reinstall the agent:
```bash
bun pm cache rm
bun uninstall -g @link-assistant/agent
bun install -g @link-assistant/agent
```

#### 2. yargs Argument Parsing Anomaly

yargs v18.0.0 has known issues with ESM-first architecture and state inheritance between calls. The default value (`opencode/kimi-k2.5-free`) might be taking precedence over the provided CLI argument in certain conditions.

Reference: https://github.com/yargs/yargs/issues/2453

#### 3. Unknown Environment-Specific Factor

Something in the production environment (environment variables, shell configuration, or process spawning) may be affecting argument parsing. This is suggested by:

- The fix works correctly when tested locally
- The same code behaves differently on the production server
- No project-level or global config files explain the behavior

## Testing Performed

### Local Reproduction Attempts (All Failed to Reproduce)

1. **Direct CLI test**:
   ```bash
   agent --model kilo/glm-5-free --verbose --dry-run
   # Result: rawModel correctly shows "kilo/glm-5-free"
   ```

2. **Piped stdin test**:
   ```bash
   echo "hi" | agent --model kilo/glm-5-free --verbose --dry-run
   # Result: rawModel correctly shows "kilo/glm-5-free"
   ```

3. **With global config file**:
   ```bash
   echo '{"model": "opencode/kimi-k2.5-free"}' > ~/.config/link-assistant-agent/opencode.json
   echo "hi" | agent --model kilo/glm-5-free --verbose --dry-run
   # Result: rawModel correctly shows "kilo/glm-5-free" (CLI takes precedence)
   ```

### Code Analysis

The model parsing code in `js/src/index.js:153-178` correctly:
1. Reads `argv.model` from yargs
2. Checks for explicit provider prefix (`kilo/glm-5-free` contains `/`)
3. Splits and logs the `rawModel`, `providerID`, and `modelID`

The bug occurs **before** this code is reached - `argv.model` is already wrong.

## Proposed Solutions

### Solution 1: Clear Bun Cache (Immediate Workaround)

```bash
bun pm cache rm
bun uninstall -g @link-assistant/agent
bun install -g @link-assistant/agent
```

### Solution 2: Add Diagnostic Logging

Add early diagnostic logging to capture `process.argv` before yargs parsing:

```javascript
// In main(), before yargs parsing
console.log('DEBUG: process.argv =', process.argv);
console.log('DEBUG: hideBin(process.argv) =', hideBin(process.argv));
```

### Solution 3: Explicitly Verify Model Argument

Add validation to detect model mismatch between command line and parsed value:

```javascript
async function parseModelConfig(argv) {
  const modelArg = argv.model;

  // Check if process.argv contains a different model
  const processModelArg = process.argv.find(
    (arg, i) => arg === '--model' && process.argv[i + 1]
  );
  if (processModelArg) {
    const processModel = process.argv[process.argv.indexOf('--model') + 1];
    if (processModel !== modelArg) {
      Log.Default.warn(() => ({
        message: 'Model argument mismatch detected',
        processArgv: processModel,
        yargsModel: modelArg,
      }));
      // Use the process.argv value as it's the true user intent
      return parseModelFromString(processModel);
    }
  }

  // ... existing code
}
```

### Solution 4: Investigate Bun Hot Module Replacement

Investigate if Bun's hot module replacement or caching mechanism might be serving stale code in production environments.

## Files Referenced

- [`data/solution-draft-log.txt`](data/solution-draft-log.txt) - Complete execution log
- [`../../issue-171/README.md`](../issue-171/README.md) - Related case study with six root causes
- [`../../issue-165/README.md`](../issue-165/README.md) - Original bug case study

## Related External Issues

- [yargs/yargs#2453](https://github.com/yargs/yargs/issues/2453) - Incorrect argument parsing in yargs
- [yargs/yargs#2377](https://github.com/yargs/yargs/issues/2377) - Bun runtime support for yargs
- [oven-sh/bun#1370](https://github.com/oven-sh/bun/issues/1370) - Yargs compatibility with Bun

## Conclusion

This issue appears to be a **recurrence of the model routing bug** (Issues #165, #171, #173) despite fixes being merged. The most likely root cause is **Bun cache serving stale code** in the production environment.

### Recommended Actions

1. Clear Bun cache on the production server
2. Reinstall the agent package
3. Add diagnostic logging to capture early argument state
4. Consider implementing model validation as a safeguard

### Key Lesson

When deploying fixes to JavaScript runtimes like Bun that use aggressive caching, always clear the cache after updates to ensure the new code is actually being executed.
