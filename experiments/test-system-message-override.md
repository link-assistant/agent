# Experiment: Test System Message Override Bug

## Issue

When using `--system-message ""`, the system is sending TWO system messages instead of just the empty one:

1. "You are Claude Code, Anthropic's official CLI for Claude." (from header)
2. The full default system message (from provider)

## Expected Behavior

`--system-message ""` should send ONLY an empty string as the system message, completely overriding all defaults.

## Root Cause Analysis

### The Bug Location

File: `src/session/prompt.ts`, line 707

```typescript
async function resolveSystemPrompt(input: {
  system?: string;
  appendSystem?: string;
  agent: Agent.Info;
  providerID: string;
  modelID: string;
}) {
  // When --system-message is provided, use it exclusively without any
  // additional context (no environment, no custom instructions, no header).
  // This is critical for models with low token limits (e.g., qwen3-32b with 6K TPM).
  if (input.system) {
    // ❌ BUG: This is falsy when input.system === ""
    return [input.system];
  }

  // Continues to build default system prompt...
  let system = SystemPrompt.header(input.providerID);
  // ...
}
```

### The Problem

- In JavaScript/TypeScript, empty string `""` is a **falsy** value
- The condition `if (input.system)` evaluates to `false` when `input.system === ""`
- This causes the function to skip the override and continue building the default system prompt
- The default prompt includes:
  1. Header: "You are Claude Code, Anthropic's official CLI for Claude." (for Anthropic providers)
  2. Provider-specific prompt: "You are OpenCode, the best coding agent on the planet." + full instructions

### The Fix

Change line 707 from:

```typescript
if (input.system) {
```

To:

```typescript
if (input.system !== undefined) {
```

This will correctly detect when the user explicitly provided a system message (including empty string) versus when no system message was provided at all.

## Test Cases

### Test 1: Empty String Override

```bash
echo "Which tools you have enabled?" | agent --model anthropic/claude-sonnet-4-5 --system-message "" --verbose
```

**Expected Output (after fix):**

- System Message 1 (0 tokens): `` (empty)
- No System Message 2

**Actual Output (before fix):**

- System Message 1 (14 tokens): "You are Claude Code, Anthropic's official CLI for Claude."
- System Message 2 (2107 tokens): Full default prompt

### Test 2: Custom System Message Override

```bash
echo "Hello" | agent --model anthropic/claude-sonnet-4-5 --system-message "You are a helpful assistant." --verbose
```

**Expected Output:**

- System Message 1 (6 tokens): "You are a helpful assistant."
- No additional system messages

### Test 3: No System Message (Default Behavior)

```bash
echo "Hello" | agent --model anthropic/claude-sonnet-4-5 --verbose
```

**Expected Output:**

- System Message 1 (14 tokens): "You are Claude Code, Anthropic's official CLI for Claude."
- System Message 2 (2107 tokens): Full default prompt

## Timeline of Events

1. User runs command with `--system-message ""`
2. CLI parses argument in `src/index.js` line 144
3. CLI passes `systemMessage` variable to `runDirectMode` or `runServerMode`
4. System calls `SessionPrompt.prompt()` with `system: ""` in the body
5. Inside loop, `resolveSystemPrompt()` is called with `system: ""`
6. **Bug occurs**: Line 707 checks `if (input.system)` which is `false` for empty string
7. Function continues to line 711 and builds default system prompt array
8. Returns array with multiple system messages instead of `[""]`

## Files Involved

- `src/cli/cmd/run.ts`: Lines 88-91, 308-324 (CLI flag parsing and passing)
- `src/index.js`: Lines 144, 525-527 (CLI flag parsing for agent mode)
- `src/session/prompt.ts`: Lines 478-484, 697-730 (System prompt resolution)
- `src/session/system.ts`: Lines 22-26 (Header prompt function)
- `src/session/prompt/anthropic_spoof.txt`: The "Claude Code" header text

## Impact

This bug prevents users from:

1. Using models with very low token limits (e.g., qwen3-32b with 6K TPM)
2. Testing with completely custom system prompts
3. Running the agent with minimal/no system context for experimentation
4. Accurately controlling what instructions the model receives

## Solution

Single line change in `src/session/prompt.ts:707`:

```diff
- if (input.system) {
+ if (input.system !== undefined) {
```

This fix ensures that:

- `--system-message ""` → returns `[""]`
- `--system-message "custom"` → returns `["custom"]`
- No `--system-message` flag → returns default system prompt array
