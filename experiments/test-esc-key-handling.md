# Test Script: ESC Key Handling in auth login

## Purpose

This experiment tests that pressing ESC during `agent auth login` exits gracefully without showing error messages or help text.

## Setup

1. Build the project: `bun install`
2. Make the CLI executable

## Test Cases

### Test 1: ESC on Provider Selection

```bash
# Run: agent auth login
# Action: Press ESC when prompted to select provider
# Expected: CLI exits silently with exit code 0
# Expected: No error message displayed
# Expected: No help text displayed
```

### Test 2: ESC on Login Method Selection

```bash
# Run: agent auth login
# Action: Select "Anthropic" provider, then press ESC when prompted for login method
# Expected: CLI exits silently with exit code 0
# Expected: No error message displayed
# Expected: No help text displayed
```

### Test 3: ESC on API Key Input

```bash
# Run: agent auth login
# Action: Select a provider with API key auth, then press ESC on API key prompt
# Expected: CLI exits silently with exit code 0
# Expected: No error message displayed
# Expected: No help text displayed
```

## Manual Testing Instructions

1. Install dependencies:

   ```bash
   bun install
   ```

2. Run the auth login command:

   ```bash
   ./src/index.js auth login
   ```

3. When prompted to select provider, press ESC

4. Verify:
   - No error message is displayed
   - No stack trace is shown
   - No help text is displayed
   - The CLI exits cleanly

## Expected Behavior Before Fix

Before the fix:

- Pressing ESC would throw `CancelledError`
- Stack trace would be displayed
- Help text would be shown
- Exit code would be non-zero

## Expected Behavior After Fix

After the fix:

- Pressing ESC exits silently
- No error message or stack trace
- No help text displayed
- Exit code is 0 (success)

## Automated Test (Future)

To create an automated test, we would need to:

1. Spawn the CLI process
2. Send input to stdin (including ESC key)
3. Capture stdout/stderr
4. Verify exit code and output

Example test pseudocode:

```typescript
import { spawn } from 'child_process';

const proc = spawn('./src/index.js', ['auth', 'login']);

// Send ESC key after a short delay
setTimeout(() => {
  proc.stdin.write('\x1b'); // ESC key
}, 500);

proc.on('exit', (code) => {
  assert.equal(code, 0, 'Exit code should be 0');
});

let output = '';
proc.stderr.on('data', (data) => {
  output += data.toString();
});

proc.on('close', () => {
  assert(!output.includes('CancelledError'), 'Should not show CancelledError');
  assert(!output.includes('Usage:'), 'Should not show help text');
});
```

## Notes

- The fix is implemented in `src/index.js` by adding a `.fail()` handler to yargs
- The handler checks for `UI.CancelledError` and exits with code 0
- Other errors are formatted using the existing `FormatError` function
- This fix applies to all commands that throw `CancelledError` (auth, mcp, agent, export)
