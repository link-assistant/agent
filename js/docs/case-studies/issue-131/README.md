# Case Study: Issue #131 - Agent CLI outputs stderr instead of stdout

## Issue Summary

Issue #131 reports that the Agent CLI outputs everything to stderr instead of stdout, contrary to Unix conventions where normal output should go to stdout and errors to stderr.

The issue requires:

- All JSON output to have a `type` field
- Everything except errors to output to stdout by default
- All output (including errors) to be in JSON format
- Log statements to be formatted as JSON with `type` field by default (configurable)

## Root Cause Analysis

### Investigation Findings

1. **Current Behavior Analysis**:
   - The Agent CLI uses `output.ts` for JSON output, which correctly sends normal output to stdout and errors to stderr
   - Log output uses `Log.ts` which was sending logs to file by default, not stdout
   - Tests expected status messages in stderr, but they should be in stdout
   - The issue was that logs were not appearing in stdout by default

2. **Code Locations Identified**:
   - `src/util/log.ts`: Log.init() was writing to file by default instead of stdout
   - `tests/stdin-input-queue.test.js`: Tests expected status messages in stderr
   - `src/cli/output.ts`: Already correctly routing output (stdout for normal, stderr for errors)

3. **Related Issues**:
   - `link-assistant/hive-mind#1163`: Hive-mind PR that handles Agent CLI output parsing
   - The issue was that logs were going to file, not that everything was going to stderr

### Timeline of Events

- **January 23, 2026**: Issue #131 reported - Agent CLI outputs stderr instead of stdout
- **Investigation**: Found that logs were going to file by default, not stdout
- **Root Cause**: Log.init() defaulted to file output instead of stdout
- **Fix Applied**: Modified Log.init() to output JSON logs to stdout by default

## Solution Implemented

### Changes Made

1. **Modified `src/util/log.ts`**:
   - Changed Log.init() to output logs to stdout by default instead of file
   - Logs now appear in stdout with proper JSON formatting

2. **Updated Tests**:
   - Modified `tests/stdin-input-queue.test.js` to expect status messages in stdout
   - Fixed test logic to parse events from correct streams

3. **Preserved Error Output**:
   - `outputError()` still uses stderr (correct)
   - Error events in json-standard go to stderr (correct)

### Verification

- All JSON output has `type` field
- Logs are formatted as JSON with `type: "log"`
- Normal output goes to stdout
- Errors go to stderr
- Logs now appear in stdout by default

## Lessons Learned

1. **Unix Conventions**: Normal output should go to stdout, errors to stderr
2. **JSON Consistency**: All structured output should use consistent `type` field
3. **UI vs Data**: UI formatting should follow the same output stream rules as data
4. **Testing**: Existing tests verify stdout output, confirming the fix direction

## Related Work

- `link-assistant/hive-mind#1163`: Handles Agent CLI output parsing in hive-mind
- Agent CLI tests confirm stdout output expectation
- Log formatting already compliant with requirements
