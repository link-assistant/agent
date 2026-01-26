# Root Cause Analysis: Issue #32 - groq/qwen/qwen3-32b Model Test Failure

## Executive Summary

The CI run https://github.com/link-assistant/agent/actions/runs/20117892062/job/57731581537 appeared to pass (exit code 0) but actually failed due to two critical bugs:

1. **Model parsing bug**: The agent incorrectly parsed model IDs containing multiple slashes
2. **False positive CI**: Test scripts exit with code 0 even when errors occur

## Timeline of Events

### Initial Trigger

- **Date**: 2025-12-11 00:34:46 UTC
- **Event**: CI workflow triggered to test model `groq/qwen/qwen3-32b`
- **Branch**: main (commit 76fb94d)

### Error Occurrence

- **Timestamp**: 2025-12-11 00:34:52-53 UTC
- **Duration**: Both tests failed within ~1 second each
- **Error**: `ProviderModelNotFoundError` with incorrect model ID

## Root Cause #1: Model Parsing Bug

### Location

File: `src/index.js`, lines 68-70

### Buggy Code

```javascript
// Parse model argument
const modelParts = argv.model.split('/');
const providerID = modelParts[0] || 'opencode';
const modelID = modelParts[1] || 'grok-code';
```

### Problem

When parsing a model string like `groq/qwen/qwen3-32b`:

- Expected: `providerID = "groq"`, `modelID = "qwen/qwen3-32b"`
- Actual: `providerID = "groq"`, `modelID = "qwen"` ❌

The code only takes `modelParts[1]`, ignoring any subsequent parts after the second slash.

### Evidence

From CI logs (line 239-244):

```
ProviderModelNotFoundError: ProviderModelNotFoundError
 data: {
  providerID: "groq",
  modelID: "qwen",
},
```

The agent looked for model ID `"qwen"` instead of `"qwen/qwen3-32b"`.

### Correct Implementation

The codebase already has a correct implementation in `src/provider/provider.ts` (lines 620-626):

```typescript
export function parseModel(model: string) {
  const [providerID, ...rest] = model.split('/');
  return {
    providerID: providerID,
    modelID: rest.join('/'),
  };
}
```

This correctly handles model IDs with multiple slashes by joining all parts after the first one.

## Root Cause #2: False Positive CI (Exit Code Bug)

### Location

Files:

- `scripts/test-model-simple.mjs`, lines 84-106
- `scripts/test-model-tools.mjs` (similar pattern)

### Buggy Pattern

```javascript
agent.on('close', (code) => {
  clearTimeout(timeout);
  logStream.end();

  console.log('');
  console.log(`Exit code: ${code}`);

  if (code === 0) {
    console.log('');
    console.log('✅ Test PASSED: Agent completed successfully');
    // ... validation checks ...
    process.exit(0); // ← Always exits 0 regardless of validation
  } else {
    console.log('');
    console.log(`❌ Test FAILED: Agent exited with code ${code}`);
    process.exit(code || 1);
  }
});
```

### Problem

The test scripts catch errors via `uncaughtException` handlers in the agent (see `src/index.js` lines 19-28), which causes the agent to exit with code 1. However, the test scripts treat exit code 0 as success without validating that the agent actually performed the expected work.

In this case:

1. Agent throws `ProviderModelNotFoundError`
2. Error handler catches it and prints error (lines 233-247 of CI log)
3. But the spawned process exits with code 0 (line 249 of CI log)
4. Test script sees code 0 and reports "✅ Test PASSED" (line 251)

### Evidence

From CI logs:

```
Line 239: ProviderModelNotFoundError: ProviderModelNotFoundError
Line 243:  data: { providerID: "groq", modelID: "qwen" }
Line 249: Exit code: 0
Line 251: ✅ Test PASSED: Agent completed successfully
```

The test reported success despite the error occurring.

## Model Name Investigation

### Research Findings

According to the Groq API documentation:

- **Model Name**: Qwen3-32B
- **Model ID**: `qwen/qwen3-32b`
- **Full Reference**: `groq/qwen/qwen3-32b` (provider/model)
- **Status**: Preview model
- **Features**: 131,072 token context window, tool calling support, reasoning capabilities

Source: https://console.groq.com/docs/models

### models.dev Verification

Querying https://models.dev/api.json shows:

```json
{
  "groq": {
    "models": {
      "qwen/qwen3-32b": {
        "id": "qwen/qwen3-32b",
        "name": "Qwen3 32B",
        "tool_call": true,
        "reasoning": true,
        ...
      }
    }
  }
}
```

The model ID contains a slash: `qwen/qwen3-32b`, making the full provider/model reference `groq/qwen/qwen3-32b`.

## Impact Analysis

### Severity: High

- **Functional Impact**: All Groq models with slashes in their IDs (e.g., `qwen/qwen3-32b`, `meta-llama/*`, `moonshotai/*`, `openai/*`) cannot be used
- **CI/CD Impact**: CI reports false positives, masking real failures
- **User Impact**: Users cannot test or use these models via the CLI

### Affected Models

From `.github/workflows/models.yml`, these models are affected:

- `groq/meta-llama/llama-4-maverick-17b-128e-instruct`
- `groq/meta-llama/llama-4-scout-17b-16e-instruct`
- `groq/meta-llama/llama-guard-4-12b`
- `groq/moonshotai/kimi-k2-instruct`
- `groq/moonshotai/kimi-k2-instruct-0905`
- `groq/openai/gpt-oss-120b`
- `groq/openai/gpt-oss-20b`
- `groq/qwen/qwen3-32b`

### Models NOT Affected

These models work fine (no slash in model ID):

- `groq/llama-3.3-70b-versatile` → `llama-3.3-70b-versatile`
- `groq/llama-3.1-8b-instant` → `llama-3.1-8b-instant`
- `groq/qwen-qwq-32b` → `qwen-qwq-32b`

## Recommendations

### Fix #1: Update Model Parsing in src/index.js

**Priority**: Critical
**Effort**: Low (5 minutes)

Change lines 68-70 from:

```javascript
const modelParts = argv.model.split('/');
const providerID = modelParts[0] || 'opencode';
const modelID = modelParts[1] || 'grok-code';
```

To:

```javascript
const modelParts = argv.model.split('/');
const providerID = modelParts[0] || 'opencode';
const modelID = modelParts.slice(1).join('/') || 'grok-code';
```

Or better yet, reuse the existing `parseModel` function:

```javascript
import { Provider } from './provider/provider.ts';
const { providerID, modelID } = Provider.parseModel(
  argv.model || 'opencode/grok-code'
);
```

### Fix #2: Fix CI Exit Code Handling

**Priority**: High
**Effort**: Medium (30 minutes)

Update test scripts to properly detect errors by:

1. Checking for error patterns in output
2. Validating expected behavior occurred
3. Exiting with non-zero code on validation failure

Example for `scripts/test-model-simple.mjs`:

```javascript
agent.on('close', (code) => {
  clearTimeout(timeout);
  logStream.end();

  console.log('');
  console.log(`Exit code: ${code}`);

  // Check for errors in output
  if (
    output.includes('Error:') ||
    output.includes('error') ||
    output.match(/\w+Error:/)
  ) {
    console.log('');
    console.log('❌ Test FAILED: Error detected in output');
    process.exit(1);
  }

  if (code === 0) {
    // Validate response
    if (
      output.includes('"4"') ||
      output.includes(': 4') ||
      output.includes('"text":"4"')
    ) {
      console.log('');
      console.log('✅ Test PASSED: Agent completed successfully');
      console.log("✅ Response validation: Contains expected answer '4'");
      process.exit(0);
    } else {
      console.log('');
      console.log('❌ Test FAILED: Response does not contain expected answer');
      process.exit(1);
    }
  } else {
    console.log('');
    console.log(`❌ Test FAILED: Agent exited with code ${code}`);
    process.exit(code || 1);
  }
});
```

### Fix #3: Update Default Model

**Priority**: Medium
**Effort**: Low (2 minutes)

Update `.github/workflows/models.yml` line 10 to use a working model as default:

```yaml
default: 'groq/llama-3.3-70b-versatile'
```

This is already correct in the workflow, so no change needed.

## Additional Observations

### Model Name Casing

The issue description mentioned:

> Also the model name is strange, may be we need to use `groq/QWEN/QWEN3-32B` (lower cased)?

**Finding**: The model ID is already lowercase `qwen/qwen3-32b`. The Groq API uses lowercase model IDs, and models.dev confirms this. No change needed.

### Default Model

The issue requested:

> Also set it as default.

**Recommendation**: Keep `groq/llama-3.3-70b-versatile` as the default since:

1. It's the most capable Groq model
2. It doesn't have the slash-in-model-ID issue
3. Qwen3-32B is marked as "Preview" (may be discontinued)

If Qwen3 should be default, wait until after the parsing bug is fixed and tested.

## Testing Plan

1. Fix model parsing in `src/index.js`
2. Test locally with: `echo "hi" | bun run src/index.js --model groq/qwen/qwen3-32b`
3. Verify it works (requires GROQ_API_KEY)
4. Fix CI exit code handling
5. Run CI workflow manually with `groq/qwen/qwen3-32b`
6. Verify CI correctly reports failures if any occur
7. Test other affected models (meta-llama, moonshotai, openai variants)

## Conclusion

This issue revealed two critical bugs:

1. Model parsing incorrectly handles model IDs with slashes
2. CI falsely reports success when tests actually fail

Both must be fixed to ensure reliable model testing and usage. The fixes are straightforward and low-risk, but testing should be thorough given the impact on CI/CD reliability.
