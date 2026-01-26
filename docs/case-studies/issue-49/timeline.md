# Timeline and Sequence of Events

## Issue Discovery Timeline

### 2025-12-16

- **12:43:13** - User runs `agent auth list` command
- **12:43:13 +38ms** - Debug output appears: `INFO  2025-12-16T12:43:13 +38ms service=models.dev file={} refreshing`
- User notices debug output breaking clean CLI UI
- Issue #49 is created

## Technical Execution Timeline

### Module Load Phase (before command execution)

```
T+0ms: User executes: agent auth list
T+0ms: Bun runtime starts, loads src/index.js
T+5ms: Import chain begins
T+10ms: src/cli/cmd/auth.ts imported
T+12ms: src/provider/models.ts imported
T+13ms: Line 8 executes: const log = Log.create({ service: 'models.dev' })
         ↓ Logger created with default write = Bun.stderr.write
T+15ms: Line 98 executes: setInterval(...).unref()
         ↓ Background refresh timer installed (will fire every 60 min)
T+20ms: All modules loaded, yargs initialized
```

### Command Parsing Phase

```
T+25ms: yargs parses process.argv
T+26ms: Identifies command: 'auth', subcommand: 'list'
T+27ms: No --verbose flag detected
T+28ms: yargs routes to AuthCommand
```

### Command Execution Phase (THE PROBLEM OCCURS HERE)

```
T+30ms: AuthListCommand.handler() invoked (auth.ts:26)
         ⚠️  Log.init() was NEVER called
         ⚠️  write function still points to Bun.stderr.write()

T+32ms: UI.empty() called (auth.ts:27)
         ↓ Clears screen

T+33ms: authPath computed (auth.ts:28-31)

T+34ms: Auth.list() called (auth.ts:35)

T+35ms: ModelsDev.get() called (auth.ts:35)
         ↓ Enters src/provider/models.ts:70

T+36ms: refresh() called (models.ts:71)
         ↓ Enters src/provider/models.ts:79

T+38ms: log.info('refreshing', { file }) called (models.ts:81)
         ↓ Enters src/util/log.ts:140-143

T+38ms: shouldLog('INFO') returns true (level = 'INFO' by default)

T+38ms: write('INFO  ' + build(message, extra)) executes
         ↓ write is still Bun.stderr.write()
         ⚠️  THIS IS THE BUG!

T+38ms: Output written to stderr:
         "INFO  2025-12-16T12:43:13 +38ms service=models.dev file={} refreshing\n"

         🔴 User sees debug output in CLI - UI is broken!

T+40ms: fetch('https://models.dev/api.json') starts

T+250ms: fetch completes or times out

T+255ms: Credentials formatted and displayed

T+260ms: Command completes
```

## Comparison with Working Commands

### agent run --verbose (WORKS CORRECTLY)

```
T+0ms: User executes: echo "test" | agent run --verbose
T+20ms: Modules loaded
T+25ms: yargs parses arguments
T+26ms: argv.verbose = true detected
T+30ms: RunCommand handler executes
T+35ms: Flag.setVerbose(true) called (run.ts:145)
T+40ms: Log.init({ print: true, level: 'DEBUG' }) called (run.ts:148)
         ↓ write still points to Bun.stderr.write (print=true)
         ✅ But this is INTENTIONAL because --verbose was specified!
T+50ms: Agent starts, logs are visible (as intended)
```

### agent (default mode, no --verbose)

```
T+0ms: User pipes input: echo "test" | agent
T+20ms: Modules loaded
T+25ms: No command specified, routes to agent mode
T+30ms: runAgentMode(argv) called (index.js:85)
T+40ms: argv.verbose checked (index.js:87) - false
T+100ms: Log.init({ print: false, level: 'INFO' }) called (index.js:182)
         ↓ write is redirected to log file
         ✅ Logs go to ~/.local/share/opencode/log/{timestamp}.log
T+120ms: Agent starts with clean output
         ✅ No debug pollution in stderr!
```

## The Critical Difference

| Command                   | Log.init() Called?            | write points to | Result                       |
| ------------------------- | ----------------------------- | --------------- | ---------------------------- |
| `agent` (piped)           | ✅ Yes (line 182)             | Log file        | ✅ Clean output              |
| `agent --verbose` (piped) | ✅ Yes (line 182, print=true) | stderr          | ✅ Intentional debug         |
| `agent run --verbose`     | ✅ Yes (run.ts:148)           | stderr          | ✅ Intentional debug         |
| `agent auth list`         | ❌ **NO**                     | stderr          | 🔴 **Bug: Unintended debug** |
| `agent mcp list`          | ❌ **NO**                     | stderr          | 🔴 **Bug: Unintended debug** |

## Background Timer Impact

Every 60 minutes (models.ts:98):

```
T+0min: Command executes, finishes
T+60min: setInterval callback fires
         ↓ ModelsDev.refresh() called
         ↓ log.info('refreshing', { file })
         ↓ If Log.init() was never called, outputs to stderr
         ⚠️  Interrupts any long-running process or piped output!
```

## Historical Context

Based on code analysis:

1. **Original Design**: Logging system was designed with `Log.init()` in mind
2. **Agent Mode First**: Agent mode (piped stdin) was implemented first with proper logging
3. **CLI Commands Added Later**: CLI commands (auth, mcp, etc.) were added without logging initialization
4. **Oversight**: No global initialization for CLI commands was implemented
5. **Discovery**: User encounters debug output and reports issue #49

## Impact Timeline

Since the CLI commands were added, every invocation has been showing debug logs:

- `agent auth list` - Shows "refreshing" message
- `agent auth login` - May show various provider/auth logs
- `agent mcp *` - May show MCP operation logs
- Any other CLI command that triggers logging

**User Impact**:

- Confusing output for users expecting clean CLI interfaces
- Breaks scripting/automation (stderr pollution)
- Makes the tool look unpolished/buggy
- Violates CLI best practices
