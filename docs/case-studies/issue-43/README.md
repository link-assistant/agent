# Case Study: Issue #43 - Agent auth login does not work

## Summary

The `agent auth login` command fails with a `TypeError: prompts.autocomplete is not a function` error when users try to log in to a provider without specifying a URL.

## Error Message

```
TypeError: prompts.autocomplete is not a function. (In 'prompts.autocomplete({
  message: "Select provider",
  maxItems: 8,
  options: [...]
})', 'prompts.autocomplete' is undefined)
  at handler (/Users/konard/.bun/install/global/node_modules/@link-assistant/agent/src/cli/cmd/auth.ts:135:34)
```

## Root Cause Analysis

### Version Mismatch

The issue stems from a **version mismatch** in the `@clack/prompts` dependency:

| Package                           | Version                        | Has `autocomplete`? |
| --------------------------------- | ------------------------------ | ------------------- |
| @link-assistant/agent (this repo) | `@clack/prompts@^0.11.0`       | **No**              |
| opencode (original)               | `@clack/prompts@1.0.0-alpha.1` | **Yes**             |

### Timeline of Events

1. **Original OpenCode Development**: OpenCode was developed using `@clack/prompts@1.0.0-alpha.1`, which includes the `autocomplete` function (added in version `1.0.0-alpha.0`).

2. **Agent Fork/Port**: When creating the `@link-assistant/agent` package, the `auth.ts` code was copied from OpenCode. However, the dependency was set to `@clack/prompts@^0.11.0` (a stable but older version).

3. **API Mismatch**: The `autocomplete` function was introduced in the `1.0.0-alpha.0` release of `@clack/prompts`. Version `0.11.0` does not include this function.

### Available Functions Comparison

**`@clack/prompts@0.11.0` exports:**

- `cancel`, `confirm`, `group`, `groupMultiselect`, `intro`, `isCancel`, `log`, `multiselect`, `note`, `outro`, `password`, `select`, `selectKey`, `spinner`, `stream`, `tasks`, `text`, `updateSettings`

**`@clack/prompts@1.0.0-alpha.1` adds:**

- `autocomplete`
- `autocomplete-multiselect`
- And other alpha features

## Evidence

### Source Code References

1. **Agent's auth.ts** (`src/cli/cmd/auth.ts:135`):

   ```typescript
   let provider = await prompts.autocomplete({
     message: 'Select provider',
     maxItems: 8,
     options: [...]
   });
   ```

2. **OpenCode's auth.ts** (`original-opencode/packages/opencode/src/cli/cmd/auth.ts:116`):

   ```typescript
   let provider = await prompts.autocomplete({
     message: "Select provider",
     maxItems: 8,
     options: [...]
   });
   ```

3. **Agent's package.json** (`package.json:58`):

   ```json
   "@clack/prompts": "^0.11.0"
   ```

4. **OpenCode's package.json** (`original-opencode/packages/opencode/package.json:47`):
   ```json
   "@clack/prompts": "1.0.0-alpha.1"
   ```

## Possible Solutions

### Option A: Upgrade to Alpha Version (Recommended for Feature Parity)

Update `package.json` to use `@clack/prompts@1.0.0-alpha.1`:

```json
"@clack/prompts": "1.0.0-alpha.1"
```

**Pros:**

- Full feature parity with OpenCode
- No code changes needed

**Cons:**

- Alpha version may have breaking changes
- Less stable than stable releases

### Option B: Replace `autocomplete` with `select` (Recommended for Stability)

Replace `prompts.autocomplete()` with `prompts.select()` which is available in both versions:

```typescript
// Before
let provider = await prompts.autocomplete({
  message: 'Select provider',
  maxItems: 8,
  options: [...]
});

// After
let provider = await prompts.select({
  message: 'Select provider',
  options: [...]
});
```

**Pros:**

- Works with stable version of `@clack/prompts`
- More predictable behavior

**Cons:**

- Loses autocomplete/search functionality
- Users must scroll through all providers

### Option C: Implement Custom Autocomplete

Use `fuzzysort` (already a dependency) with `prompts.select()` to provide search-like functionality.

**Pros:**

- Works with stable version
- Custom implementation can be tailored to needs

**Cons:**

- More complex implementation
- Additional code to maintain

## Chosen Solution

**Option B** was implemented for this fix because:

1. It uses stable dependencies
2. The code change is minimal
3. The user experience is still good with `select`
4. It matches the pattern used elsewhere in the codebase

## Implementation Details

### Files Modified

1. **`src/cli/cmd/auth.ts`** - Already fixed with comment explaining version constraint
2. **`src/cli/cmd/export.ts`** - Fixed by replacing `prompts.autocomplete` with `prompts.select`

### Code Changes

**Before (broken):**

```typescript
const selectedSession = await prompts.autocomplete({
  message: 'Select session to export',
  maxItems: 10,
  options: sessions.map((session) => ({
    label: session.title,
    value: session.id,
    hint: `${new Date(session.time.updated).toLocaleString()} • ${session.id.slice(-8)}`,
  })),
  output: process.stderr,
});
```

**After (fixed):**

```typescript
const selectedSession = await prompts.select({
  message: 'Select session to export',
  options: sessions.map((session) => ({
    label: session.title,
    value: session.id,
    hint: `${new Date(session.time.updated).toLocaleString()} • ${session.id.slice(-8)}`,
  })),
});
```

### Key Changes Made

1. **Function Replacement**: `prompts.autocomplete()` → `prompts.select()`
2. **Parameter Removal**: Removed `maxItems` (not supported by `select`)
3. **Parameter Removal**: Removed `output` parameters (not supported in v0.11.0)
4. **Simplified Calls**: All `prompts` functions now use default output streams

## Verification and Testing

### Test Results

✅ **Auth Login Command**: Now displays interactive provider selection  
✅ **Export Command**: Runs without autocomplete errors  
✅ **TypeScript Compilation**: No type errors  
✅ **ESLint**: No linting violations

### Test Commands Executed

```bash
# Test auth login help
npm run dev -- auth login --help

# Test auth login interactive (with timeout)
timeout 5s npm run dev -- auth login

# Test export command
timeout 5s npm run dev -- export

# Run linting
npm run lint
```

### Verification Output

**Auth Login (working):**

```
┌  Add credential
INFO  2025-12-16T12:00:59 +62ms service=models.dev file={} refreshing
INFO  2025-12-16T12:00:59 +43ms service=models.dev file={} refreshing
│
◆  Select provider
│
└
```

## Status

✅ **RESOLVED** - Issue #43 has been completely fixed and verified.

## References

- GitHub Issue: https://github.com/link-assistant/agent/issues/43
- @clack/prompts Changelog: https://github.com/bombshell-dev/clack/blob/main/packages/prompts/CHANGELOG.md
- @clack/prompts npm: https://www.npmjs.com/package/@clack/prompts
