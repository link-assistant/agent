# Case Study: Agent CLI Output Streams Issue #131

## Issue Summary

The Agent CLI was outputting logs to file by default instead of stdout, and tests expected status messages in stderr instead of stdout, violating Unix conventions where normal output should go to stdout.

## Root Cause Analysis

### Primary Issue: Log Output Defaulting to File

- **Problem**: `src/util/log.ts` Log.init() was writing logs to file by default, not stdout
- **Expected**: Logs should be formatted as JSON and output to stdout by default for CLI tools
- **Impact**: Logs were not visible in stdout, making debugging difficult

### Secondary Issues Identified During Investigation

1. **Test Expectations**: Tests in `tests/stdin-input-queue.test.js` expected status messages in stderr
2. **Inconsistent Behavior**: Logs went to file while other JSON output went to stdout

## Technical Details

### Code Locations Affected

- `src/util/log.ts`: Log.init() defaulted to file output
- `tests/stdin-input-queue.test.js`: Incorrect test expectations for output streams

### Changes Made

1. **Fixed Log Output**:
   - Modified Log.init() to output logs to stdout by default
   - Logs now appear in stdout with proper JSON formatting `{"type": "log", ...}`

2. **Updated Tests**:
   - Changed test expectations to look for status messages in stdout
   - Fixed test parsing logic to use correct output streams

## Timeline

- Issue reported: January 23, 2026
- Investigation: Found logs going to file by default, tests expecting wrong streams
- Fix implemented: Modified Log.init() to output to stdout, updated tests
- Testing: Verified logs appear in stdout with proper JSON formatting

## Lessons Learned

- CLI logs should go to stdout by default for visibility
- Test expectations must match intended behavior
- Unix conventions require errors on stderr, data on stdout
- JSON output should always include `type` field for easy parsing

## Verification

- Run CLI and check that logs appear on stdout with `{"type": "log", ...}` format
- Verify status messages go to stdout with `{"type": "status", ...}` format
- Confirm error messages go to stderr with `{"type": "error", ...}` format
- Confirm all output uses consistent JSON structure
