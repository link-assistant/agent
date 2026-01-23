# Issue #131: Agent CLI outputs stderr instead of stdout

## Problem Analysis

The issue reported that the Agent CLI was outputting everything to stderr instead of stdout, contrary to the expected behavior where only errors should go to stderr and all other output (including logs) should go to stdout.

## Root Cause

1. **Log Output Routing**: In `src/util/log.ts`, error-level logs were being sent to `process.stderr` while other logs went to `process.stdout`. This violated the principle that only error events should go to stderr.

2. **Tool Error Status**: Tool failures were marked with `status: 'error'` but the test expected `status: 'failed'`, indicating inconsistency in error status naming.

3. **Missing Error Events for Tool Failures**: Tool failures were only indicated through `tool_use` events with failed status, but no separate `error` events were emitted, making it harder for consumers to detect errors programmatically.

## Solution Implemented

### 1. Unified Log Output to stdout

Modified `src/util/log.ts` to send all log messages to stdout, maintaining JSON formatting with `type: 'log'`. This ensures consistency with other CLI output.

### 2. Standardized Tool Failure Status

Changed tool failure status from `'error'` to `'failed'` in `src/session/processor.ts` to match test expectations and provide clearer semantics.

### 3. Added Error Events for Tool Failures

Modified `src/cli/event-handler.js` to emit `error` events (to stderr) when tools fail, in addition to the `tool_use` events (to stdout). This provides dual notification: detailed tool state in stdout and error alerts in stderr.

## Files Modified

- `src/util/log.ts`: Unified log output to stdout
- `src/session/processor.ts`: Changed error status to 'failed'
- `src/cli/event-handler.js`: Added error events for tool failures

## Testing

The changes ensure that:

- All normal output (logs, status, tool_use events) goes to stdout
- Error events and tool failure alerts go to stderr
- JSON formatting is maintained throughout
- Tool validation tests pass with proper error handling

## Timeline

- Issue identified: CLI output routing inconsistent
- Root cause: Mixed stderr/stdout usage for logs and errors
- Solution: Unified stdout for normal output, stderr for errors
- Implementation: Code changes to enforce output streams
- Validation: Tests pass with corrected behavior
