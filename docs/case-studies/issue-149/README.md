# Case Study: Issue #149 - ZodError in Session Processor

## Summary

The Agent CLI crashes with a `ZodError` ("No matching discriminator") in the session processor when a tool execution fails or is aborted. The error occurs because the processor uses `status: 'failed'` for tool error states, but the Zod schema (`ToolStateError`) defines the valid error status as `status: 'error'`. This mismatch causes the discriminated union validation to reject the data.

## Issue Reference

- **Issue:** https://github.com/link-assistant/agent/issues/149
- **Reported by:** @konard
- **Date:** 2026-02-01
- **Component:** Session Processor (`js/src/session/processor.ts`)
- **Schema:** Message V2 ToolState (`js/src/session/message-v2.ts`)
- **Runtime:** Bun
- **AI SDK:** `ai` v6.0.0-beta.99 (Vercel AI SDK)
- **Zod version:** `zod` v4.1.12

## Incident Timeline

| Time (UTC) | Event |
|---|---|
| 12:30:28.414 | Tool `edit` starts running (part `prt_c192ee03b001...`, call `call_fb0bd3e8c545...`) |
| 12:30:28.422 | `message.part.updated` published for the tool with `status: 'running'` |
| 12:30:28.422 | A text part is published normally |
| 12:30:28.424 | **ZodError thrown** in `session.processor` service during `process` |
| 12:30:28.425 | `session.error` event published with `UnknownError` wrapping the ZodError |
| 12:30:28.431 | `session.prompt` cancels the session |
| 12:30:28.431 | `session.status` set to idle, bus unsubscribes |
| 12:30:28.435 | Full ZodError stack trace logged |

### Key Observations

1. The error occurs during the error cleanup loop at the end of `SessionProcessor.process()` (lines 375-395 of `processor.ts`)
2. The cleanup loop attempts to mark still-running tools with `status: 'failed'`, which is not a valid discriminator value
3. The `UpdatePartInput` schema validates via `z.union([MessageV2.Part, ...])`, and `MessageV2.Part` includes `ToolPart` with `state: ToolState`
4. `ToolState` is a `z.discriminatedUnion('status', [...])` accepting only: `'pending'`, `'running'`, `'completed'`, `'error'`
5. The value `'failed'` is not in the discriminated union, causing the validation error

## Root Cause Analysis

### Primary Root Cause: `status: 'failed'` vs `status: 'error'` mismatch

The bug was introduced in commit `7748404` ("fix: make log output configurable with --verbose flag") on January 23, 2026. This commit changed `'error'` to `'failed'` in three places in `processor.ts` and added a new `'failed'` check in `event-handler.js`, but did **not** update the Zod schema `ToolStateError` which still expects `status: z.literal('error')`.

**Diff from commit `7748404`:**
```diff
# processor.ts - tool-error handler (line 191)
-                        status: 'error',
+                        status: 'failed',

# processor.ts - cleanup loop check (line 380)
-              part.state.status !== 'error'
+              part.state.status !== 'failed'

# processor.ts - cleanup loop status set (line 386)
-                  status: 'error',
+                  status: 'failed',

# event-handler.js - new check added (line 73)
+        if (part.state?.status === 'failed') {
```

### Verification: Upstream OpenCode uses `'error'`

The upstream OpenCode repository (`anomalyco/opencode`) correctly uses `status: 'error'` in all corresponding locations in `processor.ts`. The `link-assistant/agent` fork diverged by changing these to `'failed'`, creating a schema-code mismatch.

**Upstream `processor.ts` (verified):**
```typescript
case "tool-error": {
  // ...
  state: {
    status: "error",  // ← Correct: matches ToolStateError schema
    // ...
  }
}
```

### Why the error manifests as it does

The `UpdatePartInput` schema is:
```typescript
z.union([
  MessageV2.Part,           // Branch 1: includes ToolPart with ToolState
  z.object({ part: TextPart, delta: z.string() }),   // Branch 2
  z.object({ part: ReasoningPart, delta: z.string() })  // Branch 3
])
```

When `status: 'failed'` is passed:
1. **Branch 1** fails: `ToolState` discriminated union has no `'failed'` value → "No matching discriminator"
2. **Branch 2** fails: expects `part` (object) and `delta` (string), both undefined
3. **Branch 3** fails: same as Branch 2

This produces the exact three-branch `invalid_union` error seen in the logs.

## Sequence of Events (Reconstructed)

```
┌─────────────────────────┐
│  Stream processing loop  │  Processing LLM response
│  in processor.ts         │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│  Tool 'edit' starts     │  status: 'running' ✓ (valid)
│  (line 123-159)         │  Published via Session.updatePart()
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│  Error occurs in stream │  Caught by try/catch (line 323)
│  (e.g. API error)       │  Error classified as non-retryable
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│  Cleanup loop           │  Lines 375-395
│  (mark running tools)   │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│  Session.updatePart()   │  Attempts: status: 'failed'
│  → fn(schema.parse())   │  ← FAILS HERE
│  → ZodError thrown!     │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│  ZodError propagates    │  Caught again by the outer try/catch
│  → Session.Error event  │  Wrapped as UnknownError
│  → Session cancelled    │  Session goes idle
└─────────────────────────┘
```

## Related Issues & Research

### Directly Related: OpenCode Issue #7439

[OpenCode Issue #7439](https://github.com/anomalyco/opencode/issues/7439) reports a very similar ZodError pattern with `invalid_union` errors involving `part`, `delta`, and discriminator failures. That issue was reported for the AIHubMix provider, but the error pattern is identical. The upstream issue may have a different root cause (provider-specific data format issues), but the error surface is the same validation path.

### Zod v4 Discriminated Union Error Reporting

Several Zod v4 issues document poor error reporting for discriminated union failures:

- [Zod #4280](https://github.com/colinhacks/zod/issues/4280): discriminatedUnion with >2 literals throws unclear errors
- [Zod #4566](https://github.com/colinhacks/zod/issues/4566): `treeifyError` returns empty errors for discriminated union failures
- [Zod #4909](https://github.com/colinhacks/zod/issues/4909): Parse errors don't include the actual discriminator value that was received

These upstream Zod issues make debugging discriminated union failures harder, as the error message doesn't clearly state "received 'failed' but expected one of 'pending', 'running', 'completed', 'error'".

## Proposed Solutions

### Solution (Implemented): Revert `'failed'` to `'error'` in processor.ts

Change all three occurrences of `status: 'failed'` back to `status: 'error'` in `processor.ts`, and update `event-handler.js` to check for `status === 'error'` instead of `status === 'failed'`.

**Files changed:**
- `js/src/session/processor.ts` (3 changes)
- `js/src/cli/event-handler.js` (1 change)

**Rationale:**
- Aligns with the Zod schema definition (`ToolStateError` uses `status: z.literal('error')`)
- Matches upstream OpenCode behavior
- Minimal change, no schema modifications needed
- The `toModelMessage` function in `message-v2.ts:705` already checks for `status === 'error'`, confirming this is the intended value

### Alternative (Not recommended): Change schema to use `'failed'`

An alternative would be to change `ToolStateError` to use `status: z.literal('failed')` and update all consumers. This is NOT recommended because:
- It diverges further from upstream OpenCode
- It requires more changes across the codebase
- The `toModelMessage` function already uses `'error'` to generate model messages

## Existing Libraries & Components

| Library/Component | Relevance |
|---|---|
| [Zod v4 `z.discriminatedUnion`](https://zod.dev/api?id=discriminated-unions) | Runtime schema validation that catches the mismatch |
| [OpenCode upstream](https://github.com/anomalyco/opencode) | Reference implementation using `status: 'error'` correctly |
| Agent's `fn()` utility (`js/src/util/fn.ts`) | Wraps callbacks with `schema.parse()` validation |

## Impact Assessment

- **Severity:** High - Tool errors crash the session instead of being handled gracefully
- **Frequency:** Every time a tool execution fails or is aborted
- **Affected users:** All users running the agent CLI
- **Workaround:** None - the error terminates the session
- **Fix complexity:** Low - 4 line changes across 2 files

## Files Referenced

- `js/src/session/processor.ts:185-206` - `tool-error` handler (uses `'failed'`, should be `'error'`)
- `js/src/session/processor.ts:377-394` - Cleanup loop (uses `'failed'`, should be `'error'`)
- `js/src/session/message-v2.ts:292-306` - `ToolStateError` schema (defines `status: z.literal('error')`)
- `js/src/session/message-v2.ts:308-317` - `ToolState` discriminated union
- `js/src/session/index.ts:361-382` - `UpdatePartInput` schema and `updatePart` function
- `js/src/util/fn.ts:1-14` - `fn()` utility that performs `schema.parse()`
- `js/src/cli/event-handler.js:73` - Event handler checks for `'failed'` (should be `'error'`)
- `js/src/session/message-v2.ts:705` - `toModelMessage` already uses `status === 'error'`

## Logs

- `full-log.txt` - Complete session log from the incident (7506 lines)

## Git Blame

The bug was introduced in commit `7748404dc3b5aba9d4da3897e068e711056c8e5b` ("fix: make log output configurable with --verbose flag") on 2026-01-23. The `'error'` → `'failed'` change appears to have been an accidental modification bundled into a logging-related commit.
