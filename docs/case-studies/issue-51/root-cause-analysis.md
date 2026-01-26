# Root Cause Analysis: Issue #51

## Problem Statement

When using `--system-message ""`, the debug output shows the system is sending TWO system messages instead of just one:

1. **System Message 1** (14 tokens): "You are Claude Code, Anthropic's official CLI for Claude."
2. **System Message 2** (2107 tokens): "You are OpenCode, the best coding agent on the planet." + full default instructions

**Expected behavior:** Only an empty string should be sent as the system message.

## Root Cause

The bug is located in **`src/session/prompt.ts` at line 707**.

### The Defective Code

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
    // ❌ BUG HERE
    return [input.system];
  }

  let system = SystemPrompt.header(input.providerID);
  system.push(
    ...(() => {
      const base = input.agent.prompt
        ? [input.agent.prompt]
        : SystemPrompt.provider(input.modelID);
      if (input.appendSystem) {
        return [base[0] + '\n' + input.appendSystem];
      }
      return base;
    })()
  );
  system.push(...(await SystemPrompt.environment()));
  system.push(...(await SystemPrompt.custom()));

  // max 2 system prompt messages for caching purposes
  const [first, ...rest] = system;
  system = [first, rest.join('\n')];
  return system;
}
```

### The Bug Explained

In JavaScript/TypeScript, the condition `if (input.system)` uses **truthy/falsy** evaluation:

- `if (input.system)` when `input.system === ""` → **false** (empty string is falsy)
- `if (input.system)` when `input.system === "custom"` → **true**
- `if (input.system)` when `input.system === undefined` → **false**

This means when a user explicitly passes `--system-message ""`, the condition evaluates to `false`, causing the function to:

1. Skip the early return on line 708
2. Continue to line 711 and build the default system prompt
3. Return an array with multiple system messages instead of just `[""]`

### The Distinction That Matters

There's a critical difference between:

- **Not providing** `--system-message` → `input.system === undefined` → Use defaults ✅
- **Explicitly providing** `--system-message ""` → `input.system === ""` → Override with empty string ✅

The current code cannot distinguish between these two cases because both evaluate to falsy.

## The Fix

Change line 707 from:

```typescript
if (input.system) {
```

To:

```typescript
if (input.system !== undefined) {
```

This change ensures:

- `input.system === ""` → Returns `[""]` (override with empty string)
- `input.system === "custom"` → Returns `["custom"]` (override with custom message)
- `input.system === undefined` → Continues to build default prompt (no override)

## Evidence from Debug Output

From the issue's debug log:

```
INFO  ... service=session.prompt --- System Prompt ---
INFO  ... service=session.prompt System Message 1 (14 tokens estimated):
INFO  ... service=session.prompt You are Claude Code, Anthropic's official CLI for Claude.
INFO  ... service=session.prompt System Message 2 (2107 tokens estimated):
INFO  ... service=session.prompt You are OpenCode, the best coding agent on the planet.
```

This confirms that:

1. The header prompt ("You are Claude Code...") from `SystemPrompt.header()` was included
2. The provider prompt ("You are OpenCode...") from `SystemPrompt.provider()` was included
3. The override did not work as intended

## Technical Details

### Call Stack

1. User runs: `agent --model anthropic/claude-sonnet-4-5 --system-message "" --verbose`
2. `src/index.js:144` - Parses `systemMessage = ""`
3. `src/index.js:479` - Calls `SessionPrompt.prompt({ system: "" })`
4. `src/session/prompt.ts:478` - Calls `resolveSystemPrompt({ system: "" })`
5. `src/session/prompt.ts:707` - **Bug**: `if ("")` evaluates to false
6. `src/session/prompt.ts:711` - Starts building default prompt
7. Returns array: `["You are Claude Code...", "You are OpenCode... [full prompt]"]`

### Files Involved

| File                                     | Lines          | Purpose                                                  |
| ---------------------------------------- | -------------- | -------------------------------------------------------- |
| `src/session/prompt.ts`                  | 707            | **Bug location**: Falsy check instead of undefined check |
| `src/session/prompt.ts`                  | 478-484        | Calls `resolveSystemPrompt()`                            |
| `src/session/prompt.ts`                  | 711-729        | Builds default system prompt                             |
| `src/session/system.ts`                  | 22-26          | Returns header prompt for Anthropic providers            |
| `src/session/prompt/anthropic_spoof.txt` | 1              | Contains "You are Claude Code..." text                   |
| `src/cli/cmd/run.ts`                     | 88-91, 308-324 | CLI flag parsing in run command                          |
| `src/index.js`                           | 144, 525-527   | CLI flag parsing in agent mode                           |

## Impact Analysis

### Users Affected

- Users trying to use models with very low token limits (e.g., qwen3-32b with 6K TPM)
- Users wanting to test with minimal system context
- Users needing complete control over system instructions
- Developers debugging prompt behavior

### Severity

**Medium-High** - The bug prevents a documented feature from working correctly, but there are workarounds (using `--append-system-message` or custom system message files).

### Workaround (Before Fix)

Use a single space instead of empty string:

```bash
agent --system-message " " --verbose
```

However, this still sends a space character rather than truly empty content.

## Testing Strategy

### Test Case 1: Empty String Override

```bash
echo "Hello" | agent --model anthropic/claude-sonnet-4-5 --system-message "" --verbose
```

**Expected:** System Message 1 should be empty (0 tokens)

### Test Case 2: Custom Override

```bash
echo "Hello" | agent --model anthropic/claude-sonnet-4-5 --system-message "You are a helper." --verbose
```

**Expected:** System Message 1 should be "You are a helper." only

### Test Case 3: Default Behavior

```bash
echo "Hello" | agent --model anthropic/claude-sonnet-4-5 --verbose
```

**Expected:** System Messages should include header and full default prompt

### Test Case 4: Append Mode

```bash
echo "Hello" | agent --model anthropic/claude-sonnet-4-5 --append-system-message "Extra instructions." --verbose
```

**Expected:** Default prompt + "Extra instructions." appended

## Related Issues and Context

- This bug was introduced when the `--system-message` flag was implemented
- The comment on lines 704-706 explicitly states the intention: "use it exclusively without any additional context"
- The implementation doesn't match the intention due to the truthy/falsy check
- Similar patterns exist in the codebase that may need review (check for other `if (optionalString)` patterns)

## Recommendations

1. **Immediate:** Apply the one-line fix to `src/session/prompt.ts:707`
2. **Testing:** Add unit tests for `resolveSystemPrompt()` with all three cases (undefined, empty, custom)
3. **Code Review:** Search codebase for similar patterns: `if (input.something)` where `something` is an optional string
4. **Documentation:** Update CLI help text to explicitly mention that empty string is supported
