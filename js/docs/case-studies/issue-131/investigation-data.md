# Issue #131: Agent CLI outputs stderr instead of stdout

## Problem Description

The Agent CLI was outputting all JSON messages to stderr instead of stdout, making it difficult for users to pipe the output or integrate with other tools that expect JSON data on stdout.

## Root Cause Analysis

### Code Analysis

1. **Output Routing**: The `output()` function in `src/cli/output.ts` was routing messages based on type:
   - Errors → stderr
   - Everything else → stdout

   However, the issue indicated that everything was going to stderr.

2. **Log Output**: The logging system in `src/util/log.ts` was always outputting logs to stdout, even when not in verbose mode, cluttering the CLI output.

3. **Event Handler**: The event handler in `src/json-standard/index.ts` correctly outputs to stdout using `process.stdout.write()`.

### Timeline of Events

- Initial implementation had proper stream routing
- Logging was added with stdout output by default
- Tests were written expecting stdout output
- Issue reported that CLI outputs to stderr instead of stdout

### Root Causes

1. **Inconsistent Output Streams**: While the output.ts correctly routed non-errors to stdout, the logging system was forcing all logs to stdout regardless of verbose mode.

2. **Test Environment**: The test `read-image-validation.tools.test.js` was expecting tool error messages in stdout, but if errors were routed to stderr, the test would fail.

3. **User Expectation**: CLI tools typically output data to stdout and errors to stderr, but the issue suggested the CLI was outputting everything to stderr.

## Proposed Solutions

### Solution 1: Consistent Stdout Output

- Modify `output()` function to send all messages to stdout
- Change `outputError()` to use `writeStdout()` instead of `writeStderr()`
- This ensures all JSON output goes to stdout for easy parsing

### Solution 2: Conditional Log Output

- Modify `Log.init()` to output logs to stdout only when `--verbose` flag is used
- When not verbose, logs go to file only
- This keeps CLI output clean for programmatic use

### Solution 3: Configurable Output Streams

- Add environment variable or flag to control output streams
- Allow users to choose between stdout-only or separated streams

## Implemented Solution

We implemented Solution 1 and Solution 2:

1. Changed `output()` and `outputError()` to always use stdout
2. Modified `Log.init()` to output logs to stdout only when verbose

This ensures:

- All JSON messages (status, events, errors) go to stdout
- Logs are suppressed by default, available with `--verbose`
- Consistent JSON formatting with `type` field
- Easy integration with other tools

## Impact Assessment

### Positive Impacts

- CLI output is now consistently on stdout
- Easier to pipe output to other tools
- Cleaner output by default (logs hidden)
- All output has `type` field for parsing

### Potential Risks

- Error messages now go to stdout instead of stderr
- May break scripts that expect errors on stderr
- Verbose logging now required to see debug info

## Testing

The changes were tested with the existing test suite, particularly:

- `read-image-validation.tools.test.js` now passes
- Manual testing confirms all output goes to stdout
- Verbose mode still shows logs

## Future Considerations

- Consider adding `--quiet` flag to suppress all output
- Add `--log-stdout` flag to force logs to stdout
- Monitor user feedback on error output location</content>
  <parameter name="filePath">/tmp/gh-issue-solver-1769196616847/js/docs/case-studies/issue-131/investigation-data.md
