# Root Cause Analysis: Debug Output Breaking CLI UI

## Issue Summary

When running `agent auth list`, the command outputs debug logging information that breaks the CLI user interface:

```
INFO  2025-12-16T12:43:13 +38ms service=models.dev file={} refreshing
```

This debug output should only be shown when the `--verbose` flag is provided.

## Root Cause Analysis

### The Problem Chain

1. **Default Logging Behavior (src/util/log.ts:55)**

   ```typescript
   let write = (msg: any) => Bun.stderr.write(msg);
   ```

   - By default, all log messages write directly to `stderr`
   - This happens **before** `Log.init()` is called
   - The default log level is `INFO` (line 19)

2. **Missing Log Initialization for CLI Commands**
   - **Agent mode** (src/index.js:182-185): Properly calls `Log.init()`
   - **Run command** (src/cli/cmd/run.ts:115): Properly calls `Log.init()`
   - **Auth commands**: **NEVER** calls `Log.init()`
   - **Other CLI commands (mcp, models, stats, export, etc.)**: Also don't call `Log.init()`

3. **Early Logger Creation (src/provider/models.ts:8)**

   ```typescript
   const log = Log.create({ service: 'models.dev' });
   ```

   - Logger is created at module import time
   - Uses default `write` function pointing to `stderr`
   - Any calls to `log.info()` will output to stderr by default

4. **Auth List Command Flow**

   **Call Chain:**

   ```
   user runs: agent auth list
   ↓
   src/index.js:519 → AuthCommand is invoked
   ↓
   src/cli/cmd/auth.ts:26 → AuthListCommand.handler()
   ↓
   src/cli/cmd/auth.ts:35 → ModelsDev.get() is called
   ↓
   src/provider/models.ts:71 → refresh() is called
   ↓
   src/provider/models.ts:81 → log.info('refreshing', { file })
   ↓
   PROBLEM: write() still points to Bun.stderr.write()
   ↓
   Debug output appears in CLI: "INFO 2025-12-16T12:43:13 +38ms service=models.dev file={} refreshing"
   ```

5. **Why Log.init() Matters**

   When `Log.init({ print: false })` is called (src/util/log.ts:57-75):

   ```typescript
   export async function init(options: Options) {
     if (options.level) level = options.level;
     cleanup(Global.Path.log);
     if (options.print) return;  // If print=true, keep using stderr

     // Create log file path
     logpath = path.join(Global.Path.log, ...);
     const logfile = Bun.file(logpath);
     const writer = logfile.writer();

     // REDIRECT write function to log file instead of stderr
     write = async (msg: any) => {
       const num = writer.write(msg);
       writer.flush();
       return num;
     };
   }
   ```

   **Before Log.init()**: `write` → `Bun.stderr.write()` ✗ visible in CLI
   **After Log.init({ print: false })**: `write` → `logfile.writer()` ✓ hidden in log file

### Timeline of Events

1. **User runs command**: `agent auth list`
2. **Module imports happen**:
   - `src/provider/models.ts` is imported
   - Line 8: `const log = Log.create({ service: 'models.dev' })` executes
   - Logger is created with default `write = Bun.stderr.write`
3. **yargs parses command**: Identifies `auth list` subcommand
4. **Command handler executes**: `AuthListCommand.handler()` at line 26
5. **Models are fetched**: Line 35 calls `ModelsDev.get()`
6. **Refresh is triggered**: Line 71 calls `refresh()`
7. **Log output occurs**: Line 81 calls `log.info('refreshing', { file })`
8. **Output goes to stderr**: Because `Log.init()` was never called
9. **User sees debug output**: Breaking the clean CLI UI

### Additional Issues

**Background Refresh Timer (src/provider/models.ts:98)**

```typescript
setInterval(() => ModelsDev.refresh(), 60 * 1000 * 60).unref();
```

This timer runs every 60 minutes in the background and will also output to stderr if `Log.init()` hasn't been called, potentially interrupting long-running processes or piped output.

## Affected Commands

Based on analysis, the following CLI commands are affected (they don't initialize logging):

1. **auth** commands:
   - `agent auth list` ✗
   - `agent auth login` ✗
   - `agent auth logout` ✗
   - `agent auth status` ✗

2. **mcp** commands (src/cli/cmd/mcp.ts):
   - `agent mcp list` ✗
   - `agent mcp install` ✗
   - Any logging in MCP operations will leak to stderr

3. **models** commands (src/cli/cmd/models.ts):
   - Any model-related operations ✗

4. **stats** commands (src/cli/cmd/stats.ts):
   - Any stats operations ✗

5. **export** commands (src/cli/cmd/export.ts):
   - Any export operations ✗

**Not Affected:**

- `agent` (default mode) ✓ - Calls Log.init() at line 182
- `agent run` ✓ - Calls Log.init() at line 115 (when verbose)

## Why This Violates Best Practices

According to CLI best practices research:

1. **Default Behavior**: CLIs should only show warnings and errors by default
2. **Verbose Flag**: INFO/DEBUG logs should only appear with `--verbose` flag
3. **Clean Output**: Regular users should enjoy a clean, focused experience
4. **Stderr vs Stdout**: Debug output mixing with command output disrupts piping and scripting

The current behavior violates all of these principles for CLI commands that don't initialize logging.

## Solution Requirements

To fix this issue, we need to:

1. **Initialize logging early** for ALL CLI commands, not just agent mode
2. **Respect the verbose flag** - Only print to stderr when `--verbose` is used
3. **Default to file logging** - Write logs to files by default (not stderr)
4. **Ensure consistency** - All commands should have the same logging behavior
5. **Maintain backward compatibility** - Don't break existing verbose flag behavior

## Proposed Solution

Add a global middleware or initialization in `src/index.js` that:

- Calls `Log.init({ print: false })` before any commands execute
- Allows `--verbose` flag to enable `Log.init({ print: true, level: 'DEBUG' })`
- Applies to ALL commands, not just agent mode

This ensures:

- By default: logs go to files in `~/.local/share/opencode/log/`
- With `--verbose`: logs print to stderr for debugging
- Clean CLI UI for all commands without debug pollution
