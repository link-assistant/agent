# Case Study: Issue #32 - groq/qwen/qwen3-32b Model Test Failure

## Overview

**Issue**: [#32 - groq/QWEN/QWEN3-32B model test failed](https://github.com/link-assistant/agent/issues/32)

**CI Run**: https://github.com/link-assistant/agent/actions/runs/20117892062/job/57731581537

**Date**: 2025-12-11

**Status**: ✅ Resolved

## Problem Statement

A CI test run for the `groq/qwen/qwen3-32b` model reported success (exit code 0), but actually failed with a `ProviderModelNotFoundError`. The error indicated that the model could not be found, and the CI system did not properly detect and report this failure.

## Root Causes Identified

### 1. Model Parsing Bug in src/index.js

**Severity**: Critical

The CLI argument parser incorrectly handled model IDs containing multiple slashes:

```javascript
// BEFORE (buggy)
const modelParts = argv.model.split('/');
const providerID = modelParts[0] || 'opencode';
const modelID = modelParts[1] || 'grok-code';

// Input: "groq/qwen/qwen3-32b"
// Result: providerID="groq", modelID="qwen" ❌
```

This caused the agent to look for model `groq/qwen` instead of `groq/qwen/qwen3-32b`.

**Fix Applied**:

```javascript
// AFTER (correct)
const modelParts = argv.model.split('/');
const providerID = modelParts[0] || 'opencode';
const modelID = modelParts.slice(1).join('/') || 'grok-code';

// Input: "groq/qwen/qwen3-32b"
// Result: providerID="groq", modelID="qwen/qwen3-32b" ✅
```

### 2. False Positive CI - Exit Code Handling

**Severity**: High

The test scripts (`scripts/test-model-simple.mjs` and `scripts/test-model-tools.mjs`) checked the process exit code but did not verify whether errors occurred in the output. This allowed tests to pass even when the agent threw exceptions.

**Fix Applied**: Added error pattern detection before checking exit codes:

```javascript
// Check for errors in output (even if exit code is 0)
const errorPatterns = [
  /\w+Error:/, // Any JavaScript error (TypeError, ReferenceError, etc.)
  /Error:/, // Generic "Error:"
  /Exception:/, // Exceptions
  /ENOENT/, // File not found
  /ECONNREFUSED/, // Connection refused
];

const hasError = errorPatterns.some((pattern) => pattern.test(output));

if (hasError) {
  console.log('');
  console.log('❌ Test FAILED: Error detected in output');
  process.exit(1);
}
```

## Impact

### Affected Models

All Groq models with slashes in their model IDs were broken:

- ✅ **Fixed**: `groq/qwen/qwen3-32b`
- ✅ **Fixed**: `groq/meta-llama/llama-4-maverick-17b-128e-instruct`
- ✅ **Fixed**: `groq/meta-llama/llama-4-scout-17b-16e-instruct`
- ✅ **Fixed**: `groq/meta-llama/llama-guard-4-12b`
- ✅ **Fixed**: `groq/moonshotai/kimi-k2-instruct`
- ✅ **Fixed**: `groq/moonshotai/kimi-k2-instruct-0905`
- ✅ **Fixed**: `groq/openai/gpt-oss-120b`
- ✅ **Fixed**: `groq/openai/gpt-oss-20b`

### Working Models (No slash in model ID)

These models were unaffected:

- ✅ `groq/llama-3.3-70b-versatile`
- ✅ `groq/llama-3.1-8b-instant`
- ✅ `groq/qwen-qwq-32b`

## Solution Implemented

### Changes Made

1. **src/index.js** (line 70)
   - Updated model parsing to handle multi-slash model IDs
   - Used `slice(1).join('/')` instead of `modelParts[1]`

2. **scripts/test-model-simple.mjs** (lines 90-105)
   - Added error detection patterns
   - Exit with code 1 if errors detected in output

3. **scripts/test-model-tools.mjs** (lines 90-105)
   - Added identical error detection patterns
   - Exit with code 1 if errors detected in output

### Model Name Research

Confirmed via Groq API documentation and models.dev:

- ✅ Correct model ID: `qwen/qwen3-32b`
- ✅ Full reference: `groq/qwen/qwen3-32b`
- ✅ Lowercase is correct (not `QWEN/QWEN3-32B`)
- ✅ Model supports tool calling
- ✅ Context window: 131,072 tokens

## Files in This Case Study

- `README.md` - This overview document
- `root-cause-analysis.md` - Detailed technical analysis
- `ci-run-20117892062.log` - Original CI logs showing the failure

## Lessons Learned

1. **Pattern Matching**: When implementing string parsing logic, always consider edge cases like multiple delimiters
2. **Test Validation**: Exit codes alone are insufficient; test scripts must validate expected behavior
3. **Error Detection**: Pattern-based error detection catches issues that exit codes miss
4. **Consistency**: The codebase already had a correct `parseModel()` function in `provider.ts` - reuse existing patterns

## Testing Recommendations

1. Test model parsing with multi-slash IDs: `groq/qwen/qwen3-32b`
2. Test model parsing with single-slash IDs: `groq/llama-3.3-70b-versatile`
3. Verify CI correctly fails when models don't exist
4. Test all affected Groq models to ensure they work

## References

- Issue: https://github.com/link-assistant/agent/issues/32
- CI Run: https://github.com/link-assistant/agent/actions/runs/20117892062
- Groq Docs: https://console.groq.com/docs/models
- Models API: https://models.dev/api.json
