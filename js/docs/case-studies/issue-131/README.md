# Case Study: Issue #131 - Agent CLI outputs stderr instead of stdout

## Overview

This case study analyzes GitHub issue #131, which reported that the Agent CLI was outputting JSON messages to stderr instead of stdout, making it difficult to integrate with other tools.

## Files

- `investigation-data.md` - Detailed analysis of the problem, root causes, and solutions
- `README.md` - This summary file

## Key Findings

1. **Root Cause**: The CLI's output routing was inconsistent - while most messages went to stdout, the logging system was forcing all logs to stdout even in non-verbose mode.

2. **Impact**: Users couldn't easily pipe CLI output to other tools, and the output was cluttered with log messages.

3. **Solution**: Modified the output system to send all JSON messages to stdout, and made log output conditional on the verbose flag.

## Changes Made

### Code Changes

- `src/cli/output.ts`: Changed `output()` and `outputError()` to always use stdout
- `src/util/log.ts`: Modified log output to go to file by default, stdout only when verbose

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
