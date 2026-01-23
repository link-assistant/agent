# Case Study: Agent CLI Output Streams Issue #131

## Issue Summary

The Agent CLI was outputting all data including logs, status messages, and errors to stderr instead of stdout, making it difficult for programs to parse the output correctly.

## Root Cause Analysis

### Primary Issue: Incorrect Output Stream Usage

- **Problem**: The CLI was sending all JSON output (logs, status, errors) to stderr
- **Expected**: Everything except errors should go to stdout, with errors optionally to stderr
- **Impact**: Programs consuming the CLI output could not easily parse stdout for data while treating stderr as errors

### Secondary Issues Identified During Investigation

1. **Log Output Format**: Logs were not consistently formatted as JSON with `type` field
2. **Input Confirmation**: Continuous mode lacked JSON confirmation of user input
3. **Error Routing**: Errors were going to stderr but should be JSON to stdout for consistency

## Technical Details

### Code Locations Affected

- `src/cli/output.ts`: Output functions routing to wrong streams
- `src/util/log.ts`: Log initialization not outputting to stdout by default
- `src/cli/continuous-mode.js`: Missing input confirmation output

### Changes Made

1. **Fixed Output Routing**:
   - Changed `outputError` to use `writeStdout` instead of `writeStderr`
   - Ensured all JSON output goes to stdout for consistent parsing

2. **Fixed Log Output**:
   - Modified `Log.init` to output logs to stdout by default
   - Changed `Bun.stdout.write` to `process.stdout.write` for correct stream usage

3. **Added Input Confirmation**:
   - Added `outputInput` calls in continuous mode `processMessage` functions
   - Ensures JSON confirmation of parsed input is output

## Timeline

- Issue reported: January 23, 2026
- Investigation: Identified stream routing and format issues
- Fix implemented: Changed output functions and log initialization
- Testing: Verified output goes to correct streams

## Lessons Learned

- CLI tools should output structured data to stdout for easy parsing
- Consistent JSON formatting with `type` fields improves interoperability
- Log output should be configurable but default to stdout for CLI tools
- Input confirmation helps with debugging and verification

## Verification

- Run CLI with `--dry-run` and verify JSON output appears on stdout
- Check that `{"type": "log", ...}` messages go to stdout
- Confirm error messages are JSON with `{"type": "error", ...}` on stdout
