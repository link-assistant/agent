# Case Study: Agent CLI outputs stderr instead of stdout (Issue #131)

## Executive Summary

The Agent CLI incorrectly sends all output to stderr instead of stdout, making it difficult for parent processes to properly separate normal output from error messages. This case study documents the root cause analysis, findings, and the implemented solution.

## Issue Details

- **Issue Number**: #131
- **Repository**: link-assistant/agent
- **Reporter**: konard
- **Date Reported**: January 2026
- **Related Issue**: [hive-mind#1151](https://github.com/link-assistant/hive-mind/issues/1151)
- **Related PR**: [hive-mind#1163](https://github.com/link-assistant/hive-mind/pull/1163)

## Problem Statement

The Agent CLI sends ALL output to stderr, including:
- Status messages (mode, startup info, options)
- Verbose log messages (`{"log":{"level":"info",...}}`)
- Structured events (`{"type":"step_start",...}`, `{"type":"tool_use",...}`, etc.)

This behavior makes it impossible for consuming applications to:
1. Properly parse stdout for structured JSON output
2. Separate normal operational output from actual errors
3. Use standard Unix pipeline patterns

## Root Cause Analysis

### Primary Locations Using stderr

After thorough code analysis, the following locations were identified as sending non-error output to stderr:

1. **`js/src/index.js:143-148`**: `outputStatus()` function uses `console.error(json)`
   - Outputs status messages to stderr instead of stdout

2. **`js/src/cli/continuous-mode.js:39-44`**: Duplicate `outputStatus()` function
   - Same issue as above

3. **`js/src/util/log.ts:93`**: Default log writer uses `Bun.stderr.write(msg)`
   - All log messages default to stderr

4. **`js/src/util/log-lazy.ts:99-100`**: Lazy logging uses `process.stderr.write(json + '\n')`
   - Lazy log evaluation writes to stderr

5. **`js/src/cli/ui.ts:26-50`**: UI output functions use `process.stderr.write()`
   - Progress and status UI elements go to stderr

### Why This Happened

The original design decision appears to have been:
- Keep stdout "clean" for structured JSON parsing
- Use stderr for "meta" information like logs and status

However, this violates the Unix convention where:
- stdout = normal program output (structured data in this case)
- stderr = error messages and diagnostics only

## Impact Assessment

### Affected Use Cases

1. **Tool Integration**: The `--tool agent` mode in hive-mind fails because:
   - hive-mind's `agent.lib.mjs` expected JSON on stdout
   - All JSON was actually coming from stderr
   - stderr was not being parsed as JSON

2. **Pipeline Usage**: Standard Unix pipelines don't work:
   ```bash
   # This captures nothing because output is on stderr
   agent -p "hello" | jq .

   # This works but conflates errors with normal output
   agent -p "hello" 2>&1 | jq .
   ```

3. **Parent Process Integration**: Any process spawning the agent must:
   - Read from stderr for normal output
   - Cannot distinguish actual errors from normal output

## Solution Design

### Requirements (from issue description)

1. Output everything except errors to stdout by default
2. All JSON output must have a `type` field
3. Flatten log statements from `{ "log": { "level": "info", ... } }` to `{ "type": "log", "level": "info", ... }`
4. Log formatting should be configurable (consistent with other JSON output)
5. User input confirmation should be echoed in JSON format

### Implementation Changes

#### 1. Status Output to stdout

Modified `outputStatus()` in both `index.js` and `continuous-mode.js` to:
- Use `process.stdout.write()` for non-error status messages
- Continue using `console.error()` only for actual error types

#### 2. Log Output Configuration

Modified `Log` module in `util/log.ts` to:
- Default to stdout for log output
- Allow configuration for stderr when specifically needed
- Support the new flattened format with `type: "log"`

#### 3. Flattened Log Format

Changed from:
```json
{"log":{"level":"info","timestamp":"2026-01-23T...","message":"..."}}
```

To:
```json
{"type":"log","level":"info","timestamp":"2026-01-23T...","message":"..."}
```

#### 4. Consistent JSON Formatting

All JSON output now:
- Respects `--compact-json` flag
- Has consistent `type` field
- Uses same formatting function

## Files Changed

1. `js/src/index.js` - Output routing
2. `js/src/cli/continuous-mode.js` - Continuous mode output
3. `js/src/util/log.ts` - Log formatting and output destination
4. `js/src/json-standard/index.ts` - JSON event types
5. `js/src/cli/ui.ts` - UI output (kept on stderr as appropriate for interactive UI)

## Testing

### Manual Testing

```bash
# Verify status output goes to stdout
agent -p "hello" 2>/dev/null | head -1 | jq .type

# Verify errors still go to stderr
agent --invalid-option 2>&1 1>/dev/null | head -1

# Verify log output format
agent --verbose -p "hello" | grep '"type":"log"'
```

### Automated Tests

Added tests in `js/tests/` to verify:
- Status messages go to stdout
- Error messages go to stderr
- Log format is correct
- `type` field is present in all JSON output

## Lessons Learned

1. **Follow Unix Conventions**: stdout for data, stderr for errors
2. **Consistent Output Format**: All JSON should have a `type` field for easy parsing
3. **Document Output Contract**: API consumers need clear documentation on output format
4. **Test Output Streams**: Automated tests should verify which stream receives which output

## References

- [Issue #131](https://github.com/link-assistant/agent/issues/131)
- [PR #132](https://github.com/link-assistant/agent/pull/132)
- [hive-mind PR #1163](https://github.com/link-assistant/hive-mind/pull/1163)
- [Unix Philosophy - Standard Streams](https://en.wikipedia.org/wiki/Standard_streams)
