# Case Study: Issue #131 - Agent CLI outputs stderr instead of stdout

## Issue Summary

The Agent CLI was reported to output everything to stderr instead of stdout, except for errors which should go to stderr. All JSON output should include a `type` field for consistency, and log statements should be formatted as flattened JSON objects with `type: "log"`.

## Timeline of Events

- **Jan 23, 2026**: Issue #131 opened, claiming CLI outputs everything to stderr
- **Analysis**: Code review revealed proper separation in most places, but logs were only output when `--verbose` flag was used
- **Root Cause**: Logging system defaulted to file output to keep CLI clean, but issue requires logs in JSON format to stdout by default

## Root Causes Identified

1. **Logging Output**: `Log.init()` was called with `print: Flag.OPENCODE_VERBOSE`, meaning logs only went to stdout in verbose mode, otherwise to file
2. **Inconsistent Log Formatting**: Some legacy code used nested `{"log": {...}}` format instead of flattened `{"type": "log", ...}`
3. **Missing Input Confirmation**: No JSON confirmation of parsed user input was output

## Code Analysis

- `src/cli/output.ts`: Properly separates stdout (status, logs, events) and stderr (errors)
- `src/util/log.ts`: Uses flattened JSON format with `type: "log"`, but output destination depended on verbose flag
- `src/json-standard/index.ts`: Event handlers output to stdout
- `src/index.js`: Middleware initialized logging with conditional print

## Proposed Solutions

1. **Always output logs to stdout**: Change `Log.init({ print: true })` to ensure logs are always visible in JSON format
2. **Ensure consistent formatting**: All JSON output uses `type` field
3. **Add input confirmation**: Output parsed input in JSON format before processing

## Implementation

- Modified `src/index.js` to always set `print: true` for logging
- Added `outputInput` call in single-message mode to confirm parsed input
- Verified all output functions use proper streams

## Testing

- Run CLI with `--help` to verify status messages go to stdout
- Run with a prompt to check log output format
- Verify error messages still go to stderr

## Additional Data

- No external logs available as issue is recent
- Codebase analysis shows proper stream usage in most places
- Bun runtime handles stdout/stderr correctly
