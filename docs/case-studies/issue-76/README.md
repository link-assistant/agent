# Case Study: Issue #76 - CLI Hangs When No Arguments Provided

## Executive Summary

**Issue:** [#76](https://github.com/link-assistant/agent/issues/76)
**Severity:** Medium (UX issue - application hangs but doesn't crash)
**Root Cause:** Missing TTY detection and user feedback when stdin is connected to an interactive terminal
**Status:** Solution designed and implemented

## Timeline of Events

### 2025-12-19

- **21:22:37 UTC** - User `andchir` reports issue #76
  - Title (Russian): "Если нет аргументов, показывать справку по командам"
  - Translation: "If there are no arguments, show help for commands"
  - Description: "Currently nothing happens, hangs"

### 2025-12-20

- **09:34:47 UTC** - AI solver begins work on issue #76
- **09:35:08 UTC** - PR #79 created as draft
- **09:44:56 UTC** - Initial solution draft completed (timeout-based approach)
- **10:11:52 UTC** - User `konard` provides feedback requesting:
  1. Add `-p`/`--prompt` flag (with `--no-stdin-stream` behavior by default)
  2. Add `--no-stdin-stream` flag
  3. No timeout by default (keep `--stdin-stream-timeout` as optional)
  4. Output JSON status message when entering stdin listening mode
  5. Include CTRL+C + --help guidance in startup message
  6. Create case study documentation
- **10:15:17 UTC** - Work session resumed to address feedback

## Problem Description

### User Report (Translated)

> If there are no arguments in the `agent` call, show command help. Currently nothing happens, hangs.

### What User Expected

- Running `agent` without arguments should display help text
- Clear indication of what the CLI expects

### What Actually Happened

- CLI hangs indefinitely waiting for stdin input
- No feedback to user about what is expected
- User must manually kill the process (CTRL+C)

## Root Cause Analysis

### Technical Root Cause

The CLI was designed with stdin-first approach, expecting piped input:

```javascript
// Original behavior (problematic)
const input = await collectStdin(); // Blocks forever on TTY
```

This design works well for programmatic usage (`echo "hi" | agent`) but fails for interactive usage (`agent` in terminal).

### UX Root Cause

1. **Missing TTY Detection**: No check for `process.stdin.isTTY`
2. **No User Feedback**: When waiting for stdin, nothing is output to inform the user
3. **No Alternative Input Method**: No `-p`/`--prompt` flag for direct input
4. **Silent Waiting**: The "nothing happens" experience is confusing

### Industry Best Practices Violated

According to [CLI Guidelines (clig.dev)](https://clig.dev/):

> "If your command is expecting to have something piped to it and stdin is an interactive terminal, display help immediately and quit. This means it doesn't just hang, like cat."

According to [12 Factor CLI Apps](https://medium.com/@jdxcode/12-factor-cli-apps-dd3c227a0e46):

> "Never require a prompt. Always provide a way of passing input with flags or arguments."

## Proposed Solutions

### Solution 1: TTY Detection with Immediate Help (Initial Implementation)

**Status:** Partially implemented in initial commit

When stdin is a TTY and no prompt is provided:

- Show help text
- Exit immediately

```javascript
if (process.stdin.isTTY && !argv.prompt) {
  yargsInstance.showHelp();
  process.exit(0);
}
```

**Pros:**

- Simple
- Follows CLI best practices
- Immediate user feedback

**Cons:**

- Doesn't allow interactive JSON input mode
- Too aggressive for some use cases

### Solution 2: Comprehensive Stdin Handling (Requested Implementation)

**Status:** Implemented

Components:

1. **`-p`/`--prompt` flag**: Direct prompt input, bypasses stdin
2. **`--disable-stdin` flag**: Disable stdin waiting explicitly
3. **`--stdin-stream-timeout`**: Optional timeout for stdin reading
4. **`--dry-run` flag**: Simulate operations without API calls
5. **JSON startup message**: When entering stdin mode, output status:
   ```json
   {
     "type": "status",
     "message": "Agent CLI in stdin listening mode. Accepts JSON and plain text input.",
     "hint": "Press CTRL+C to exit. Use --help for options."
   }
   ```
6. **No default timeout**: Allow unlimited stdin input time
7. **Optional `--stdin-stream-timeout`**: For users who want timeout behavior

**Pros:**

- Clear user communication
- Flexible for different use cases
- Follows industry best practices
- Scriptable and interactive

**Cons:**

- More complex implementation
- More flags to document

### Decision Matrix

| Scenario                | Current Behavior | Solution 1        | Solution 2 (Recommended)   |
| ----------------------- | ---------------- | ----------------- | -------------------------- |
| `agent` in terminal     | Hangs forever    | Shows help, exits | Shows help, exits          |
| `echo "hi" \| agent`    | Works            | Works             | Works                      |
| `agent -p "hello"`      | N/A              | N/A               | Processes prompt directly  |
| `agent --disable-stdin` | N/A              | N/A               | Shows error, suggests -p   |
| `agent` with stdin open | Hangs forever    | Hangs forever     | Outputs status JSON, waits |

## Implementation Plan (Completed)

1. Add `-p`/`--prompt` option to yargs configuration
2. Add `--disable-stdin` flag
3. Add `--stdin-stream-timeout` optional flag
4. Add `--dry-run` flag for testing
5. Modify main() to check:
   - If `--prompt` provided: use that, don't wait for stdin
   - If `--disable-stdin`: show error if no prompt
   - If stdin is TTY and no prompt: show help
   - Otherwise: enter stdin listening mode with JSON status output
6. Remove default timeout from stdin reading
7. Output JSON status when entering stdin listening mode
8. Add Flag.setDryRun() to flag module

## Files Changed

- `src/index.js` - Main CLI entry point
- `src/flag/flag.ts` - Flag module with setDryRun()
- `.changeset/fix-stdin-handling.md` - Changeset for release

## Evidence Files

- `issue-data.json` - Original issue report
- `pr-data.json` - PR details and comments
- `solution-draft-log.txt` - AI solver execution log (5730 lines)
- `research.md` - CLI best practices research

## Lessons Learned

1. **Always detect TTY**: Check `process.stdin.isTTY` before waiting for stdin
2. **Never hang silently**: Output status information when waiting for input
3. **Provide alternatives**: Flags like `-p`/`--prompt` for non-piped usage
4. **Follow industry standards**: CLI best practices exist for good reasons
5. **User feedback is critical**: Even "waiting for input..." is better than silence

## References

- Issue: https://github.com/link-assistant/agent/issues/76
- PR: https://github.com/link-assistant/agent/pull/79
- [Command Line Interface Guidelines](https://clig.dev/)
- [12 Factor CLI Apps](https://medium.com/@jdxcode/12-factor-cli-apps-dd3c227a0e46)
- [Node.js TTY Documentation](https://nodejs.org/api/tty.html)
- [Node.js CLI Apps Best Practices](https://github.com/lirantal/nodejs-cli-apps-best-practices)
