# Case Study: OpenRouter Model Not Found Error (Issue #135)

## Executive Summary

When a user attempts to use an OpenRouter model with incorrect format (`z-ai/glm-4.7` instead of `openrouter/z-ai/glm-4.7`), the CLI throws a `ProviderModelNotFoundError`. This case study documents the root cause analysis, timeline reconstruction, and proposed solutions.

## Issue Details

- **Issue Number**: #135
- **Repository**: link-assistant/agent
- **Reporter**: andchir
- **Date Reported**: January 2026
- **Status**: Open

## Problem Statement

The user authenticated with OpenRouter but received a `ProviderModelNotFoundError` when trying to use a model:

```bash
echo "hello" | agent --model z-ai/glm-4.7
```

Error received:
```
ProviderModelNotFoundError: ProviderModelNotFoundError
    at new NamedError (unknown:1:28)
    at new ProviderModelNotFoundError (...src/util/error.ts:28:9)
    at <anonymous> (...src/provider/provider.ts:912:30)
```

## Timeline Reconstruction

1. **User Action**: User authenticated with OpenRouter (confirmed working)
2. **User Command**: Ran `echo "hello" | agent --model z-ai/glm-4.7`
3. **Model Parsing**: The `parseModel()` function split the model string:
   - `providerID` = `"z-ai"`
   - `modelID` = `"glm-4.7"`
4. **Provider Lookup**: Code attempted to find provider `"z-ai"` in `s.providers`
5. **Failure**: No provider named `"z-ai"` exists, threw `ProviderModelNotFoundError`

## Root Cause Analysis

### Primary Root Cause

**Incorrect model format**: The user used `z-ai/glm-4.7` but the correct format is `openrouter/z-ai/glm-4.7`.

### Technical Details

The model parsing logic in `provider.ts:1067-1073`:

```typescript
export function parseModel(model: string) {
  const [providerID, ...rest] = model.split('/');
  return {
    providerID: providerID,
    modelID: rest.join('/'),
  };
}
```

When parsing `z-ai/glm-4.7`:
- First segment becomes `providerID` = `"z-ai"`
- Remaining segments become `modelID` = `"glm-4.7"`

The code then checks if this provider exists:

```typescript
const provider = s.providers[providerID];
if (!provider) throw new ModelNotFoundError({ providerID, modelID });
```

Since `z-ai` is not a registered provider (it's actually a model vendor within OpenRouter), the error is thrown.

### Contributing Factors

1. **Lack of documentation**: OpenRouter is not documented in `MODELS.md`
2. **Confusing naming**: OpenRouter models have nested paths like `openrouter/z-ai/glm-4.7` which can be confusing
3. **No error message guidance**: The error doesn't suggest the correct format or similar models

## Verification

### Available OpenRouter GLM Models

From `models.dev/api.json`, the available GLM models in OpenRouter are:

| Model ID | Model Name |
|----------|------------|
| `openrouter/thudm/glm-z1-32b:free` | GLM Z1 32B (Free) |
| `openrouter/z-ai/glm-4.7` | GLM-4.7 |
| `openrouter/z-ai/glm-4.5` | GLM-4.5 |
| `openrouter/z-ai/glm-4.5-air` | GLM-4.5 Air |
| `openrouter/z-ai/glm-4.5v` | GLM-4.5V |
| `openrouter/z-ai/glm-4.6` | GLM-4.6 |
| `openrouter/z-ai/glm-4.6:exacto` | GLM-4.6 Exacto |
| `openrouter/z-ai/glm-4.5-air:free` | GLM-4.5 Air (Free) |

### Correct Command

```bash
echo "hello" | agent --model openrouter/z-ai/glm-4.7
```

## Proposed Solutions

### Solution 1: Better Error Message (Recommended)

Improve the error message to suggest similar models or the correct format:

```typescript
if (!provider) {
  // Check if it might be an OpenRouter model
  const allProviders = Object.keys(s.providers);
  const possibleMatch = allProviders.find(p =>
    s.providers[p]?.info?.models?.[`${providerID}/${modelID}`]
  );

  if (possibleMatch) {
    throw new ModelNotFoundError({
      providerID,
      modelID,
      suggestion: `Did you mean: ${possibleMatch}/${providerID}/${modelID}?`
    });
  }
  throw new ModelNotFoundError({ providerID, modelID });
}
```

### Solution 2: Documentation Update

Add OpenRouter to `MODELS.md` with examples:

```markdown
## OpenRouter Provider

[OpenRouter](https://openrouter.ai/) provides access to multiple AI models through a unified API.

### Configuration

Set your API key:
```bash
export OPENROUTER_API_KEY=your_api_key_here
```

Or authenticate via CLI:
```bash
agent auth openrouter
```

### Model Format

OpenRouter models use nested paths:
- Format: `openrouter/<vendor>/<model>`
- Example: `openrouter/z-ai/glm-4.7`

### Available Models (Examples)

| Model | Model ID |
|-------|----------|
| GLM-4.7 | `openrouter/z-ai/glm-4.7` |
| GLM-4.5 | `openrouter/z-ai/glm-4.5` |
| Claude 3.5 Sonnet | `openrouter/anthropic/claude-3.5-sonnet` |
```

### Solution 3: Model ID Fuzzy Matching

Implement fuzzy matching to suggest similar models when the exact model is not found.

## Impact Assessment

### Severity: Low

- The CLI correctly rejects invalid model formats
- The fix is a documentation/UX improvement rather than a functional bug

### Affected Users

- Users new to OpenRouter who don't know the correct model format
- Users migrating from other tools with different naming conventions

## Files Relevant to Solution

1. `js/src/provider/provider.ts:912` - Error throwing location
2. `js/src/provider/provider.ts:1067-1073` - Model parsing logic
3. `MODELS.md` - Documentation (needs OpenRouter section)
4. `js/src/util/error.ts` - Error definition

## Testing Recommendations

### Manual Testing

```bash
# Verify correct model format works
export OPENROUTER_API_KEY=your_key
echo "hello" | agent --model openrouter/z-ai/glm-4.7

# Verify improved error message (after fix)
echo "hello" | agent --model z-ai/glm-4.7
# Should suggest: "Did you mean: openrouter/z-ai/glm-4.7?"
```

## Lessons Learned

1. **Document all supported providers**: Every provider should be documented in `MODELS.md`
2. **Helpful error messages**: Error messages should guide users toward the correct solution
3. **Model naming conventions**: Nested paths can be confusing; consider documenting patterns

## References

- [Issue #135](https://github.com/link-assistant/agent/issues/135)
- [OpenRouter Documentation](https://openrouter.ai/docs)
- [models.dev API](https://models.dev/api.json)
- [provider.ts source](../../js/src/provider/provider.ts)
