# Case Study: Issue #131 - Agent CLI outputs stderr instead of stdout

## Overview

This case study analyzes GitHub issue #131, which reported that the Agent CLI was outputting JSON messages to stderr instead of stdout, making it difficult to integrate with other tools.

## Files

- `investigation-data.md` - Detailed analysis of the problem, root causes, and solutions
- `README.md` - This summary file

## Key Findings

1. **Root Cause**: The CLI's output routing was incorrect - all messages, including errors, were being sent to stdout instead of following Unix conventions where errors should go to stderr.

2. **Impact**: Users couldn't easily distinguish between normal output and errors when using the CLI programmatically, and error handling was more difficult.

3. **Solution**: Modified the output system to route messages based on type - errors go to stderr, all other messages (status, logs, events) go to stdout.

## Changes Made

### Code Changes

- `src/cli/output.ts`: Updated `output()` function to route `type: 'error'` messages to stderr, all others to stdout
- `src/util/log.ts`: Logs with `type: 'log'` correctly go to stdout as they are not errors

### Test Updates

- `tests/read-image-validation.tools.test.js`: Added `--no-always-accept-stdin` to test single-message mode

## Verification

The fix was verified by:

- Running the affected test case successfully
- Manual testing of CLI output streams
- Ensuring all JSON output includes the required `type` field

## Lessons Learned

1. Consistent output streams are crucial for CLI tool usability
2. Log output should be configurable to avoid cluttering primary output
3. JSON formatting with type fields enables better programmatic integration
4. Test cases should account for output stream expectations</content>
   <parameter name="filePath">/tmp/gh-issue-solver-1769196616847/js/docs/case-studies/issue-131/README.md
