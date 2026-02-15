# Case Study: MiniMax M2.5 Free Model Support

**Issue:** [#190](https://github.com/link-assistant/agent/issues/190)
**Date:** February 2026
**Status:** Resolved

## Summary

This case study documents the investigation and resolution of model availability discrepancies between our documentation and the actual free model offerings from OpenCode Zen and Kilo Gateway.

## Problem Statement

The issue reported that:
1. `minimax-m2.5-free` should be the default free model going to OpenCode Zen
2. `kilo/minimax-m2.5-free` should route to Kilo when available
3. `opencode/minimax-m2.1-free` is no longer available for free
4. Documentation needed verification against current provider offerings

## Research Findings

### OpenCode Zen (anomalyco/opencode)

**Source:** [packages/web/src/content/docs/zen.mdx](https://github.com/anomalyco/opencode)

Current free models on OpenCode Zen:
- `kimi-k2.5-free` - Recommended
- `minimax-m2.5-free` - Available (NEW)
- `big-pickle` - Stealth model
- `gpt-5-nano` - Available

**Discontinued free models:**
- `minimax-m2.1-free` - No longer free (still available as paid: $0.30/$1.20)
- `glm-4.7-free` - No longer free

### Kilo Gateway (Kilo-Org/kilo)

**Source:** [packages/kilo-gateway/src/api/constants.ts](https://github.com/Kilo-Org/kilo)

Default free model in Kilo codebase:
```typescript
export const DEFAULT_FREE_MODEL = "minimax/minimax-m2.1:free"
```

Current free models on Kilo:
- `z-ai/glm-5:free` - Flagship, limited time free
- `z-ai/glm-4.5-air:free` - Agent-centric
- `minimax/minimax-m2.5:free` - General purpose
- `deepseek/deepseek-r1-0528:free` - Reasoning
- `giga-potato` - Evaluation
- `arcee-ai/trinity-large-preview:free` - Preview

**Note:** Kilo's `DEFAULT_FREE_MODEL` constant still references M2.1, but M2.5 is now available.

### Models.dev API

The models.dev API doesn't directly track OpenCode Zen or Kilo free models. Free model information must be obtained directly from provider documentation.

## Changes Made

### 1. MODELS.md Updates
- Replaced `opencode/minimax-m2.1-free` with `opencode/minimax-m2.5-free`
- Removed `opencode/glm-4.7-free` (no longer free)
- Added discontinued models section with M2.1 and GLM 4.7
- Updated Kilo free models table with current offerings
- Updated usage examples

### 2. docs/kilo.md Updates
- Replaced old free models with current offerings
- Added `kilo/minimax-m2.5-free`, `kilo/glm-4.5-air-free`, `kilo/deepseek-r1-free`
- Added note about discontinued models
- Updated comparison table

### 3. FREE_MODELS.md (New)
- Created comprehensive free models documentation
- Lists all current free models from both providers
- Documents discontinued models
- Provides guidance on choosing between providers

### 4. Provider Code (js/src/provider/provider.ts)
- Already had correct Kilo model mappings for `minimax-m2.5-free`
- No code changes required - provider.ts was up-to-date

## Key Insights

1. **Model versioning differs between providers:** OpenCode Zen upgraded from M2.1 to M2.5 for the free tier, while Kilo's constants still reference M2.1 but M2.5 is available.

2. **Free model availability is dynamic:** Free models come and go based on provider partnerships and promotional periods. Documentation should note that availability may change.

3. **Provider-specific model IDs:** Kilo uses different internal model IDs (e.g., `minimax/minimax-m2.5:free`) than what users see (e.g., `kilo/minimax-m2.5-free`).

4. **GLM model changes:** GLM 4.7 was replaced by GLM 4.5 Air in the free tier, and GLM-5 is the new flagship (limited time free).

## External References

- [OpenCode Zen Documentation](https://opencode.ai/docs/zen/)
- [Kilo Gateway Documentation](https://kilo.ai/docs/gateway)
- [Kilo Free Models](https://kilo.ai/docs/advanced-usage/free-and-budget-models)
- [MiniMax Developer Console](https://platform.minimax.io/)

## Testing Recommendations

To verify free model availability:

```bash
# Test OpenCode Zen free models
echo "test" | agent --model opencode/minimax-m2.5-free
echo "test" | agent --model opencode/kimi-k2.5-free

# Test Kilo Gateway free models
echo "test" | agent --model kilo/minimax-m2.5-free
echo "test" | agent --model kilo/glm-5-free
```

## Resolution

All documentation has been updated to reflect the current state of free model availability. The provider code already correctly supported `minimax-m2.5-free` for both OpenCode Zen and Kilo Gateway.
