# Issue #131: Agent CLI outputs stderr instead of stdout

## Problem Description

The Agent CLI was outputting all JSON messages to stdout, including errors, instead of following Unix conventions where errors should go to stderr and data to stdout.

## Root Cause Analysis

### Code Analysis

1. **Output Routing**: The `output()` function in `src/cli/output.ts` was not routing messages based on type - all messages were going to stdout regardless of type.

2. **Error Handling**: Error messages were being sent to stdout instead of stderr, violating Unix conventions.

3. **Event Handler**: The event handler in `src/json-standard/index.ts` outputs to stdout, which is correct for data events.

### Root Causes

1. **Missing Type-Based Routing**: The `output()` function lacked logic to route error messages to stderr.

2. **Unix Convention Violation**: CLI tools should send data to stdout and errors to stderr for proper tool integration.

## Proposed Solutions

### Solution 1: Type-Based Output Routing

- Modify `output()` function to check message type
- Route `type: 'error'` messages to stderr
- Route all other messages to stdout
- This follows Unix conventions: stdout for data, stderr for errors

## Implemented Solution

We implemented Solution 1:

1. Updated `output()` function to route based on message type
2. Error messages now go to stderr, all others to stdout
3. All messages remain in JSON format with `type` field

This ensures:

- Errors go to stderr (following Unix conventions)
- Data (status, logs, events) goes to stdout
- Consistent JSON formatting with `type` field
- Easy integration with other tools that can handle separated streams

## Impact Assessment

### Positive Impacts

- Follows Unix CLI conventions
- Errors can be redirected separately from data
- Easier error handling in scripts
- All output has `type` field for parsing

## Testing

The changes were tested by:

- Running CLI with valid input - status and data messages go to stdout
- Running CLI with invalid input - error messages go to stderr
- Manual testing confirms proper stream separation
- All JSON output includes required `type` field

## Future Considerations

- Consider adding `--quiet` flag to suppress all output
- Add `--log-stdout` flag to force logs to stdout
- Monitor user feedback on error output location</content>
  <parameter name="filePath">/tmp/gh-issue-solver-1769196616847/js/docs/case-studies/issue-131/investigation-data.md
