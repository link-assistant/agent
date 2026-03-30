# Case Study: Separate Compaction Model for Extended Context Usage

**Issue:** [#219](https://github.com/link-assistant/agent/issues/219)
**PR:** [#220](https://github.com/link-assistant/agent/pull/220)

## Problem Statement

The agent uses a single model for both main interactions and context compaction (summarization). When the context window fills up, compaction is triggered with a 15% safety margin, meaning only 85% of the usable context is available before compaction kicks in. This wastes context capacity, especially when a smaller free model with a larger context window (like `gpt-5-nano` at 400K tokens) could handle the compaction task.

## Key Insight

If the compaction model has a **larger** context window than the base model, the entire base model's context can be used without a safety margin. The compaction model can ingest all of the base model's context for summarization because it has room to spare.

For example:
- Base model `minimax-m2.5-free`: 204,800 token context
- Compaction model `gpt-5-nano`: 400,000 token context

Since `gpt-5-nano` can handle 400K tokens, it can easily process a full 204K context dump from the base model. No safety margin is needed.

## Context Window Data (Free Models)

| Model | Context | Output | Provider |
|-------|---------|--------|----------|
| minimax-m2.5-free | 204,800 | 131,072 | opencode |
| gpt-5-nano | 400,000 | 128,000 | opencode |
| big-pickle | 200,000 | 128,000 | opencode |
| glm-5-free | 204,800 | 131,072 | opencode/kilo |
| kimi-k2.5-free | 262,144 | 262,144 | opencode |
| mimo-v2-pro-free | 1,048,576 | 64,000 | opencode |
| nemotron-3-super-free | 1,000,000 | 128,000 | opencode |

Sources:
- [models.dev API](https://models.dev/api.json)
- [OpenAI GPT-5 Nano](https://platform.openai.com/docs/models/compare?model=gpt-5-nano) - 400K context
- [Issue #217 case study](../issue-217/README.md) - context size verification

## Solution

### New CLI Arguments

1. **`--compaction-model`** (default: `opencode/gpt-5-nano`)
   - Specifies the model used for context compaction/summarization
   - Special value `same` uses the base model (original behavior)
   - Supports `provider/model` and short name formats

2. **`--compaction-safety-margin`** (default: `15`)
   - Safety margin as a percentage of usable context window
   - Only applies when the compaction model has equal or smaller context than the base model
   - When the compaction model has a larger context, margin is automatically 0%

### Smart Safety Margin Logic

```
if compaction_model.context > base_model.context:
    safety_margin_ratio = 1.0  (use 100% of base context)
elif compaction_model == "same":
    safety_margin_ratio = 1 - (margin_percent / 100)
else:
    safety_margin_ratio = 1 - (margin_percent / 100)
```

### Architecture

The compaction model config flows through:

```
CLI (--compaction-model, --compaction-safety-margin)
  → argv.ts (process.argv parsing)
  → model-config.js (resolution + validation)
  → index.js (threading to run modes)
  → continuous-mode.js (continuous stdin mode)
  → prompt.ts (PromptInput schema, stored on User message)
  → message-v2.ts (persisted on user messages for session resume)
  → compaction.ts (isOverflow, contextDiagnostics, process)
```

### Files Changed

| File | Change |
|------|--------|
| `js/src/cli/defaults.ts` | Added `DEFAULT_COMPACTION_MODEL`, `DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT` |
| `js/src/cli/argv.ts` | Added `getCompactionModelFromProcessArgv`, `getCompactionSafetyMarginFromProcessArgv` |
| `js/src/cli/model-config.js` | Added `parseCompactionModelConfig` |
| `js/src/index.js` | Added `--compaction-model`, `--compaction-safety-margin` options; threaded through |
| `js/src/cli/continuous-mode.js` | Threaded compaction model config |
| `js/src/session/message-v2.ts` | Added `compactionModel` to User message schema |
| `js/src/session/prompt.ts` | Added `compactionModel` to PromptInput; resolves compaction model context limit |
| `js/src/session/compaction.ts` | Added `CompactionModelConfig`, `computeSafetyMarginRatio`; updated `isOverflow`, `contextDiagnostics` |
| `js/tests/compaction-model.test.ts` | 18 unit tests for safety margin logic |

## Impact

With the default configuration (`--compaction-model opencode/gpt-5-nano`), the agent gains approximately **15% more usable context** for the base model before compaction triggers. For a model with 204K context and 32K output:

- **Before:** usable = 168K * 0.85 = **142,800 tokens**
- **After:** usable = 168K * 1.0 = **168,000 tokens**
- **Gain:** +25,200 tokens (~18% more working space)

This effectively extends the free tier's useful context by using a secondary free model (`gpt-5-nano`) that has a larger context window for compaction tasks.
