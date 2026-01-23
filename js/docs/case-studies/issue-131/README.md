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
   - Log output uses `Log.ts` which sends logs to stdout when in CLI mode (print=true)
   - However, UI components (`ui.ts`) were writing to stderr instead of stdout
   - Export command was writing status messages to stderr

2. **Code Locations Identified**:
   - `src/cli/ui.ts`: All UI functions (`println`, `error`, `success`, `info`, `empty`) wrote to `process.stderr`
   - `src/cli/cmd/export.ts`: Status message wrote to `process.stderr`
   - `src/session/agent.js`: Error logging wrote to `process.stderr` (correct for errors)

3. **Related Issues**:
   - `link-assistant/hive-mind#1163`: Hive-mind PR that handles Agent CLI output, claiming it outputs to stderr
   - The Agent CLI does output JSON to stdout, but UI elements were going to stderr

### Timeline of Events

- **Initial Implementation**: Agent CLI designed with JSON output to stdout, UI to stderr (conventional)
- **Issue Reported**: User claims CLI outputs everything to stderr
- **Investigation**: Found UI components writing to stderr, violating "everything except errors to stdout"
- **Fix Applied**: Changed UI components to write to stdout, export command to stdout

## Solution Implemented

### Changes Made

1. **Modified `src/cli/ui.ts`**:
   - Changed all `process.stderr.write` to `process.stdout.write`
   - UI output now goes to stdout as required

2. **Modified `src/cli/cmd/export.ts`**:
   - Changed `process.stderr.write` to `process.stdout.write` for status messages

3. **Preserved Error Output**:
   - `outputError()` still uses stderr (correct)
   - Error logs in `session/agent.js` remain on stderr (correct)

### Verification

- All JSON output already has `type` field
- Logs are formatted as JSON with `type: "log"`
- Normal output goes to stdout
- Errors go to stderr
- UI output now goes to stdout

## Lessons Learned

1. **Unix Conventions**: Normal output should go to stdout, errors to stderr
2. **JSON Consistency**: All structured output should use consistent `type` field
3. **UI vs Data**: UI formatting should follow the same output stream rules as data
4. **Testing**: Existing tests verify stdout output, confirming the fix direction

## Related Work

- `link-assistant/hive-mind#1163`: Handles Agent CLI output parsing in hive-mind
- Agent CLI tests confirm stdout output expectation
- Log formatting already compliant with requirements
