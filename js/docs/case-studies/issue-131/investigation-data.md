# Issue #131: Agent CLI outputs stderr instead of stdout

## Problem Description

The Agent CLI was using direct `process.stderr.write` calls for error logging in `src/session/agent.js`, bypassing the centralized output system and using inconsistent JSON formatting.

## Root Cause Analysis

### Code Analysis

1. **Direct stderr Usage**: `src/session/agent.js` contained direct `process.stderr.write` calls for tool execution errors
2. **Inconsistent Formatting**: Error logs used nested JSON format `{log: {...}}` instead of flattened `{type: 'log', ...}`
3. **Output Routing**: The `output()` function was routing all messages to stdout, including errors

### Root Causes

1. **Bypassed Abstraction**: Direct stream writes circumvented the centralized output system
2. **Format Inconsistency**: Nested log format didn't match the required flattened format
3. **Stream Misrouting**: Errors were going to stdout instead of stderr

## Proposed Solutions

### Solution 1: Centralized Error Logging

- Replace direct `process.stderr.write` with `outputLog()` calls
- Use flattened JSON format with `type: 'log'` field
- Ensure errors go to stderr via proper routing

## Implemented Solution

We implemented Solution 1:

1. **Fixed Agent Logging**: Replaced `process.stderr.write` with `outputLog()` in `src/session/agent.js`
2. **Updated Output Routing**: Modified `output()` function to route errors to stderr
3. **Consistent Formatting**: All logs now use `{type: 'log', ...}` format

This ensures:

- Errors go to stderr (following Unix conventions)
- Data (status, logs, events) goes to stdout
- Consistent JSON formatting with `type` field
- Centralized output handling

## Impact Assessment

### Positive Impacts

- Follows Unix CLI conventions
- Consistent JSON output format
- Centralized output management
- Better error stream separation

## Testing

The changes were tested by:

- Running CLI with tool execution - logs go to stdout in correct format
- Verifying error routing to stderr
- Checking JSON structure consistency
- All output includes required `type` field

## Future Considerations

- Monitor for other direct stream writes
- Ensure all logging uses centralized functions
- Maintain Unix convention compliance</content>
  <parameter name="filePath">/tmp/gh-issue-solver-1769196616847/js/docs/case-studies/issue-131/investigation-data.md
