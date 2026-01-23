# Issue #131 Investigation: Agent CLI outputs stderr instead of stdout

## Issue Summary

The issue claims that the Agent CLI outputs everything to stderr instead of stdout, and requests to ensure that everything except errors goes to stdout in JSON format with a `type` field.

## Current Implementation Analysis

### Output Routing

- **stdout**: Normal output (status, events, data) - implemented in `src/cli/output.ts`
- **stderr**: Errors only - implemented in `src/cli/output.ts`

The `output()` function in `src/cli/output.ts` correctly routes messages:

- Messages with `type === 'error'` go to stderr
- All other messages go to stdout

### Event Handling

- Events are output via `eventHandler.output()` in `src/json-standard/index.ts`
- This uses `process.stdout.write()` for all events
- Events include `type` field as requested

### Logging

- Logs are formatted as JSON with `type: 'log'` in `src/util/log.ts`
- In print mode (verbose), logs go to stdout
- Follows Unix conventions: stdout for data, stderr for errors

### Test Results

Running the CLI with a test message shows all output going to stdout, including:

- Status messages
- Log messages with `type: 'log'`
- Event messages with appropriate types

## Timeline Reconstruction

1. **Issue Creation**: Jan 23, 2026 - Issue reported claiming CLI outputs to stderr
2. **JSON Standard Implementation**: Dec 9, 2025 - Added `--json-standard` option with proper stdout output
3. **Current State**: Output correctly goes to stdout for non-errors

## Root Cause Analysis

The issue appears to have been resolved by the implementation of the JSON standard output system. Before this, the CLI may have been outputting events/logs to stderr, but the current implementation correctly separates:

- stdout: status, logs, events, tool results
- stderr: errors only

## Verification

Test command executed:

```bash
echo '{"message":"test"}' | bun run src/index.js
```

Result: All output appears on stdout, properly formatted as JSON with `type` fields.

## Conclusion

The current implementation correctly outputs everything except errors to stdout. The issue may have been present before the JSON standard implementation but is now resolved. The CLI follows Unix conventions and provides consistent JSON output with type fields.
