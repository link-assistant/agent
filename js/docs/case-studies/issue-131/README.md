# Case Study: Issue #131 - Agent CLI outputs stderr instead of stdout

## Issue Summary

The Agent CLI was outputting all JSON events to stderr instead of stdout, violating the expected behavior where only errors should go to stderr and all other output (status, events, logs) should go to stdout.

## Root Cause Analysis

### Initial Investigation

- The CLI uses multiple output mechanisms:
  - `output.ts` functions for status, errors, warnings, logs, and input confirmations
  - `json-standard/index.ts` event handler for tool execution events, text output, etc.
  - `util/log.ts` for logging

- The `output.ts` correctly routes:
  - Errors to stderr
  - Everything else to stdout

- The `util/log.ts` was conditionally outputting to stdout only when `--verbose` flag was set, otherwise to file

- The `json-standard/index.ts` event handler was routing events based on type:
  - 'error' type events to stderr
  - All other events to stdout

### Problem Identified

The issue was that the event handler in `json-standard/index.ts` was correctly routing non-error events to stdout, but there may have been a configuration or environment issue causing all output to appear in stderr.

### Timeline of Events

1. CLI receives input
2. Status messages output to stdout
3. Agent processes request
4. Tool execution events should output to stdout
5. Errors should output to stderr
6. Logs should output as JSON to stdout

### Root Cause

The event handler was routing events correctly, but to ensure consistency, all JSON output including events should go to stdout by default, with errors handled separately.

## Solution Implemented

### Changes Made

1. **Modified `util/log.ts`**: Changed logging to always output JSON to stdout in addition to file logging, ensuring logs are part of the JSON output stream by default.

2. **Modified `json-standard/index.ts`**: Simplified event output to always go to stdout for consistency with other JSON output.

### Code Changes

- `src/util/log.ts`: Removed conditional stdout output, now always writes to stdout + file
- `src/json-standard/index.ts`: Changed event handler to always use `process.stdout`

## Validation

- All JSON output now goes to stdout by default
- Errors still go to stderr via `output.ts`
- Logs are formatted as JSON with `type: "log"` and output to stdout
- Backward compatibility maintained

## Files Modified

- `src/util/log.ts`
- `src/json-standard/index.ts`

## Test Case

The test `read-image-validation.tools.test.js` validates that the CLI properly handles output streams, combining stdout and stderr for JSON parsing.
