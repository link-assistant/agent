# Case Study: Issue #171 - `--model kilo/glm-5-free` is not working

## Summary

When users specify `--model kilo/glm-5-free` through the `solve` CLI tool, the @link-assistant/agent system incorrectly routes the request to `opencode/kimi-k2.5-free` instead. This is a regression or recurrence of issue #165, despite the fix being included in version 0.12.1.

## Issue Details

- **Issue URL**: https://github.com/link-assistant/agent/issues/171
- **Reporter**: konard
- **Date**: 2026-02-14
- **Agent Version**: 0.12.1 (confirmed in logs)
- **Related Issues**: #165 (same problem, supposedly fixed)

## Timeline of Events

| Timestamp (UTC) | Event |
|-----------------|-------|
| 2026-02-14T11:37:01.071Z | User executed: `solve ... --model kilo/glm-5-free` |
| 2026-02-14T11:37:32.064Z | Solve reports: `Model: kilo/glm-5-free` (correct) |
| 2026-02-14T11:37:32.112Z | Agent command: `agent --model kilo/glm-5-free --verbose` |
| 2026-02-14T11:37:32.551Z | Agent logs: `command: "... --model kilo/glm-5-free ..."` (correct in command) |
| 2026-02-14T11:37:32.566Z | **BUG**: `"using explicit provider/model"` with `opencode/kimi-k2.5-free` |
| 2026-02-14T11:37:32.625Z | Provider `kilo` found (correct provider available) |
| 2026-02-14T11:37:32.625Z | **FAILURE**: `getModel` called with `opencode/kimi-k2.5-free` (wrong!) |
| 2026-02-14T11:37:32.660Z | API call made to OpenCode Zen instead of Kilo Gateway |

## Root Cause Analysis

### Evidence Summary

1. **Command is correct**: The log shows `--model kilo/glm-5-free` was passed to the agent
2. **Parse result is wrong**: The `parseModelConfig` function logged `opencode/kimi-k2.5-free`
3. **Fix is present**: The 0.12.1 npm package contains the fix from commit c38133d
4. **Kilo provider is available**: The log shows `providerID: "kilo"` was found

### Potential Root Causes

#### 1. Bun Cache Issue (Most Likely)
The user may have an old cached version of the agent code in Bun's module cache that wasn't invalidated when upgrading to 0.12.1.

**Evidence**:
- The fix IS in 0.12.1 (verified by extracting npm tarball)
- Local testing with fresh install works correctly
- The behavior matches pre-fix code

**Solution**: User needs to clear Bun cache and reinstall:
```bash
bun pm cache rm
bun install -g @link-assistant/agent
```

#### 2. Yargs Default Value Taking Precedence (Unlikely)
There may be a bug in yargs 18.0.0 where the default value takes precedence over provided arguments in certain edge cases (e.g., when stdin is piped).

**Evidence Against**: Our reproduction tests with piped stdin work correctly.

#### 3. Config File Override (Ruled Out)
The config file could set a model, but `parseModelConfig` reads from `argv.model` which should come from CLI.

**Evidence Against**: `parseModelConfig` reads `argv.model` directly, not from config.

### Code Path Analysis

The relevant code flow:

```javascript
// In index.js parseModelConfig()
async function parseModelConfig(argv) {
  const modelArg = argv.model;  // Should be "kilo/glm-5-free"

  if (modelArg.includes('/')) {
    const modelParts = modelArg.split('/');
    providerID = modelParts[0];  // Should be "kilo"
    modelID = modelParts.slice(1).join('/');  // Should be "glm-5-free"

    Log.Default.info(() => ({
      message: 'using explicit provider/model',
      providerID,  // But log shows "opencode"
      modelID,     // But log shows "kimi-k2.5-free"
    }));
  }
}
```

For the logged output to show `opencode/kimi-k2.5-free`, `argv.model` must have been `"opencode/kimi-k2.5-free"` (the yargs default).

## Recommendations

### Immediate Actions

1. **User should reinstall**:
   ```bash
   bun pm cache rm
   bun install -g @link-assistant/agent
   ```

2. **Verify installation**:
   ```bash
   bun agent --version
   # Should show 0.12.1

   grep "using explicit" ~/.bun/install/global/node_modules/@link-assistant/agent/src/index.js
   # Should show the logging code
   ```

### Code Improvements

1. **Add raw argv.model logging** (implemented):
   ```javascript
   Log.Default.info(() => ({
     message: 'using explicit provider/model',
     rawArgvModel: argv.model,  // NEW: log the raw input
     providerID,
     modelID,
   }));
   ```

2. **Add validation warning**:
   ```javascript
   if (modelArg === 'opencode/kimi-k2.5-free') {
     Log.Default.warn(() => ({
       message: 'Model is set to default value, verify --model argument is being parsed correctly',
       processArgv: process.argv.join(' '),
     }));
   }
   ```

## Data Files

- [`full-log.log`](full-log.log) - Complete execution log from the user
- [`data/`](data/) - Additional analysis data

## Related Resources

- [Issue #165 Case Study](../issue-165/README.md) - Previous occurrence of this bug
- [Fix commit c38133d](https://github.com/link-assistant/agent/commit/c38133d) - The fix that should have resolved this
- [Kilo Gateway Documentation](https://kilo.ai/docs/gateway) - Documentation for Kilo provider

## Conclusion

The issue appears to be caused by a **stale cache** of the agent code. Despite the fix being present in the published 0.12.1 version, the user's runtime is executing old code that doesn't include the fix. The recommended resolution is to clear the Bun module cache and reinstall the agent package.

### Verification Steps

1. Clear cache: `bun pm cache rm`
2. Reinstall: `bun install -g @link-assistant/agent`
3. Verify fix is present: Check for "using explicit provider/model" log message
4. Test: `agent --model kilo/glm-5-free --verbose --prompt "test"`

If the issue persists after reinstallation, additional debugging will be needed.
