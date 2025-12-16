# Case Study: Issue #45 - ESC Key Handling in auth login

## Issue Summary
When a user runs `agent auth login` and presses the ESC key to cancel a prompt, instead of gracefully exiting, the CLI throws a `CancelledError` and displays the command help text.

## Timeline of Events

### What Happened
1. User ran `agent auth login`
2. CLI prompted to select provider → User selected "Anthropic"
3. CLI prompted to select login method → User selected "Claude Pro/Max"
4. User pressed ESC key to cancel
5. CLI threw `CancelledError` with stack trace
6. CLI displayed command help text instead of gracefully exiting

## Root Cause Analysis

### Error Flow
1. When ESC is pressed in `@clack/prompts`, `prompts.isCancel()` returns true
2. Code in `src/cli/cmd/auth.ts` throws `new UI.CancelledError()` (lines 160, 176, 196, 206, 263, 328, 369, 404)
3. The error propagates up through the async command handler
4. **Yargs default behavior**: When an async command handler throws an error, yargs displays the help text
5. The error is caught by the main catch block in `src/index.js:574` which logs it as JSON
6. The error formatting in `src/cli/error.ts:30` that should return empty string for `CancelledError` is never called

### Why the Error Wasn't Handled Properly

The codebase has a `FormatError` function in `src/cli/error.ts` that correctly handles `UI.CancelledError` by returning an empty string:

```typescript
if (UI.CancelledError.isInstance(input)) return '';
```

However, this function is never called because:
1. Yargs doesn't have a custom `.fail()` handler configured in `src/index.js`
2. When async command handlers throw errors, yargs has a default behavior of showing help text
3. The error bubbles up to the global catch block which doesn't use `FormatError`

### Comparison with OpenCode CLI

The issue description mentions: "Please use ./original-opencode (source code of OpenCode CLI), we need to make sure agent auth login is working exactly the same way as in OpenCode CLI."

The original-opencode directory is empty, but based on the code structure and the existence of the `FormatError` function, it's clear that the intention was to:
1. Catch `CancelledError` gracefully
2. Display nothing (empty string) when user cancels
3. Exit cleanly without showing error or help text

## Proposed Solutions

### Solution 1: Add Yargs .fail() Handler (Recommended)
Add a custom `.fail()` handler to yargs in `src/index.js` that:
1. Catches errors from command handlers
2. Uses `FormatError` to format the error
3. Suppresses help text for `CancelledError`
4. Exits with code 0 for cancellation, code 1 for other errors

**Pros:**
- Centralized error handling for all commands
- Reuses existing `FormatError` logic
- Consistent behavior across all commands
- Aligns with OpenCode CLI design

**Cons:**
- None

### Solution 2: Wrap Command Handlers with Try-Catch
Wrap each command handler in a try-catch block.

**Pros:**
- More granular control per command

**Cons:**
- Requires changes to multiple files
- Code duplication
- Error-prone if new commands are added

### Solution 3: Process Exit in Command Handler
Catch `CancelledError` in each command and call `process.exit(0)` directly.

**Pros:**
- Simple to implement

**Cons:**
- Bypasses yargs lifecycle
- Not clean architecture
- Harder to test

## Recommended Implementation

**Solution 1** is the best approach because:
1. It's centralized and maintainable
2. It uses the existing `FormatError` infrastructure
3. It handles all commands consistently
4. It properly distinguishes between cancellation (exit 0) and errors (exit 1)

## References
- GitHub Issue: https://github.com/link-assistant/agent/issues/45
- Yargs async handler error behavior: https://github.com/yargs/yargs/issues/2394
- Yargs fail() handler docs: https://github.com/yargs/yargs/blob/main/docs/advanced.md#handling-failures

## Technical Details

### Files Involved
- `src/index.js` - Main entry point where yargs is configured
- `src/cli/cmd/auth.ts` - Auth command that throws CancelledError
- `src/cli/error.ts` - FormatError function that should handle errors
- `src/cli/ui.ts` - UI.CancelledError class definition
- `src/util/error.ts` - NamedError base class

### Error Instance Check
The `FormatError` function uses:
```typescript
if (UI.CancelledError.isInstance(input)) return '';
```

This is the correct way to check for `CancelledError` instances using the `NamedError` framework.
