# Case Study: Issue #82 - Listening Mode Should Be Enabled by Default

## Overview

**Issue:** [link-assistant/agent#82](https://github.com/link-assistant/agent/issues/82)
**Reported By:** @konard
**Date:** 2025-12-20
**Type:** Bug / Enhancement
**Related PR:** [#79](https://github.com/link-assistant/agent/pull/79) (stdin handling improvements)

## Problem Statement

The user reports several issues with the current stdin handling behavior:

1. **Single-message mode:** Agent only processes the first message from stdin, then exits. User cannot send additional messages during or after the agent processes the first message.

2. **Process exits after first response:** When using `echo '{"message":"hi"}' | agent`, after the agent responds, the user typed "hi2" but the input was returned to the shell instead of being processed by the agent.

3. **Status message is shown in compact JSON:** The status message `{"type":"status",...}` is output as a single line, which the user expects to be pretty-printed.

4. **Missing `--always-accept-stdin` option:** Need an option to keep accepting stdin even after the agent finishes its work.

5. **Missing option to toggle JSON pretty printing:** By default, JSON should be pretty-printed, with an option to disable for program-to-program communication.

## Timeline of Events (Reconstructed)

```
1. User runs: echo '{"message":"hi"}' | agent

2. Agent receives input via stdin pipe

3. Agent outputs status message to stderr:
   {"type":"status","mode":"stdin-stream",...}

4. Agent reads stdin until EOF (which arrives after echo completes)

5. Agent processes the message: {"message":"hi"}

6. Agent outputs JSON response to stdout (pretty-printed):
   {
     "type": "step_start",
     ...
   }
   {
     "type": "text",
     ...
     "text": "Hi! How can I help you today?"
   }
   {
     "type": "step_finish",
     ...
   }

7. Agent exits after session becomes idle

8. User types "hi2" but it goes to the shell (zsh) because agent has already exited

9. Shell interprets "hi2" as a command, fails with "command not found"
```

## Root Cause Analysis

### Root Cause 1: Single-Shot Stdin Reading

**Location:** `src/index.js:81-129` (`readStdinWithTimeout` function)

**Problem:** The current implementation reads stdin until EOF is received. When input comes from a pipe (`echo ... | agent`), EOF is sent as soon as the echo command completes, before the agent even starts processing.

```javascript
function readStdinWithTimeout(timeout = null) {
  return new Promise((resolve) => {
    // ...
    const onEnd = () => {
      cleanup();
      resolve(data); // Resolves on EOF, ending stdin reading
    };
    // ...
  });
}
```

**Impact:** The agent processes only the first batch of input, then exits. There's no mechanism to continue reading stdin for additional messages.

### Root Cause 2: No Continuous Input Mode

**Location:** `src/index.js:752-790`

**Problem:** The main function reads stdin once, processes it, and runs the agent. There's no loop to continue reading and processing additional messages.

```javascript
// Read stdin with optional timeout
const input = await readStdinWithTimeout(timeout);
const trimmedInput = input.trim();
// ...
// Run agent mode (single execution, then exit)
await runAgentMode(argv, request);
```

**Impact:** Even though `InputQueue` class exists with continuous reading capabilities (in `src/cli/input-queue.js`), it's not being utilized in the main flow.

### Root Cause 3: Status Message Uses `console.error` with Compact JSON

**Location:** `src/index.js:136-138`

**Problem:** The `outputStatus` function outputs compact JSON to stderr:

```javascript
function outputStatus(status) {
  console.error(JSON.stringify(status)); // No pretty printing
}
```

**Impact:** Status messages are hard to read for humans while debugging or in interactive use.

### Root Cause 4: Missing CLI Options

**Location:** `src/index.js:557-696`

**Problem:** The following options are missing:

- `--always-accept-stdin` - to keep accepting input even after agent finishes
- `--compact-json` (or similar) - to explicitly control JSON pretty-printing

**Impact:** Users cannot configure the agent behavior to match their needs.

### Root Cause 5: Event Output Already Pretty-Prints (Inconsistency)

**Location:** `src/json-standard/index.ts:50-60`

**Current Behavior:**

```typescript
export function serializeOutput(
  event: OpenCodeEvent | ClaudeEvent,
  standard: JsonStandard
): string {
  if (standard === 'claude') {
    return JSON.stringify(event) + EOL; // Compact for claude
  }
  return JSON.stringify(event, null, 2) + EOL; // Pretty for opencode
}
```

The main JSON output IS already pretty-printed for the "opencode" standard. However, status messages (which go to stderr) are NOT pretty-printed.

## Proposed Solutions

### Solution 1: Implement Continuous Stdin Reading Mode

Modify the stdin handling to continuously read and process messages:

1. Use `createContinuousStdinReader` from `src/cli/input-queue.js`
2. Process messages as they arrive via the queue
3. Keep the session alive between messages
4. Exit only on EOF (end of stdin), SIGINT (Ctrl+C), or explicit exit command

### Solution 2: Add `--always-accept-stdin` Option

Add a new CLI option that:

- When enabled (default: true), continuously accepts stdin input
- When disabled, processes only the first message and exits
- Pairs with `--no-always-accept-stdin` for programmatic use

### Solution 3: Add `--compact-json` Option

Add a CLI option to control JSON output formatting:

- When enabled, output compact JSON (for machine consumption)
- When disabled (default), output pretty-printed JSON
- Affects both stderr (status) and stdout (events)

### Solution 4: Pretty-Print Status Messages by Default

Modify `outputStatus` to respect the JSON formatting setting:

```javascript
function outputStatus(status, compact = false) {
  const json = compact
    ? JSON.stringify(status)
    : JSON.stringify(status, null, 2);
  console.error(json);
}
```

### Solution 5: Support Multi-Turn Conversations

Extend the session handling to:

1. Keep the session open after the first response
2. Queue incoming messages and process them sequentially
3. Allow the AI to maintain context across messages
4. Handle concurrent message sending gracefully

## Implementation Priority

1. **High:** Continuous stdin reading with multi-message support
2. **High:** Add `--always-accept-stdin` option (with sensible default)
3. **Medium:** Add `--compact-json` option
4. **Medium:** Pretty-print status messages
5. **Low:** Update README.md and help text

## References

- Issue: https://github.com/link-assistant/agent/issues/82
- Related PR: https://github.com/link-assistant/agent/pull/79
- Input Queue Implementation: `src/cli/input-queue.js`
- JSON Formatting: `src/json-standard/index.ts`
