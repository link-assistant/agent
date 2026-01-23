# Case Study: Agent CLI Output Streams Issue #131

## Issue Summary

The Agent CLI was outputting tool execution errors to stderr in a nested JSON format instead of using the standardized output system, and error messages were not being routed to stderr as required by Unix conventions.

## Root Cause Analysis

### Primary Issue: Direct stderr Usage in Agent Code

- **Problem**: `src/session/agent.js` was using `process.stderr.write` directly for error logging with nested JSON format `{log: {...}}`
- **Expected**: All output should use the centralized `output.ts` functions, with flattened JSON format `{type: 'log', ...}`, and errors should go to stderr
- **Impact**: Inconsistent output formatting and stream usage

### Secondary Issues Identified During Investigation

1. **Error Routing**: The `output()` function was sending all messages to stdout, including errors, violating Unix conventions
2. **Log Format**: Direct stderr writes used nested format instead of flattened format with `type` field

## Technical Details

### Code Locations Affected

- `src/session/agent.js`: Direct `process.stderr.write` for error logging
- `src/cli/output.ts`: `output()` function not routing errors to stderr

### Changes Made

1. **Fixed Agent Error Logging**:
   - Replaced direct `process.stderr.write` with `outputLog()` call
   - Changed nested format `{log: {...}}` to flattened format `{type: 'log', ...}`

2. **Fixed Error Output Routing**:
   - Modified `output()` function to route `type: 'error'` messages to stderr, all others to stdout
   - Updated `outputError()` to use `writeStderr()` directly

## Timeline

- Issue reported: January 23, 2026
- Investigation: Found direct stderr usage in agent.js and incorrect error routing
- Fix implemented: Centralized error logging and fixed output routing
- Testing: Verified proper stream separation and JSON formatting

## Lessons Learned

- All CLI output should go through centralized functions for consistency
- Unix conventions require errors on stderr, data on stdout
- JSON output should always include `type` field for easy parsing
- Direct stream writes should be avoided in favor of abstraction layers

## Verification

- Run CLI and check that logs appear on stdout with `{"type": "log", ...}` format
- Verify error messages go to stderr with `{"type": "error", ...}` format
- Confirm all output uses consistent JSON structure
