# Case Study: Update Free Models List and Default Model to Qwen 3.6 Plus Free

**Issue:** [#232](https://github.com/link-assistant/agent/issues/232)
**PR:** [#234](https://github.com/link-assistant/agent/pull/234)

## Problem Statement

OpenCode Zen added new free models (Qwen 3.6 Plus Free and Nemotron 3 Super Free) that were not reflected in the agent's code, defaults, or documentation. The default model was still `minimax-m2.5-free` (~200K context) when `qwen3.6-plus-free` (~1M context) offers a significantly larger context window.

Additionally, the compaction system only supported a single compaction model. When that model hit rate limits or the context exceeded its capacity, compaction would fail. A cascade of models ordered by context size would make compaction more resilient.

## Key Insight

Free models have different context windows and independent rate limits. By trying compaction with the cheapest/smallest model first and cascading to larger ones when needed, the system can:

1. **Minimize costs** — smaller models are tried first
2. **Maximize availability** — if one model's rate limit is hit, the next one is tried
3. **Handle large contexts** — if the used context exceeds a model's limit, skip to a larger model

## Context Window Data (OpenCode Zen Free Models, April 2026)

| Model                  | Context    | Output  | Notes                                        |
| ---------------------- | ---------- | ------- | -------------------------------------------- |
| big-pickle             | ~200,000   | 128,000 | Stealth model, free during evaluation        |
| minimax-m2.5-free      | ~200,000   | 65,536  | General-purpose                              |
| nemotron-3-super-free  | ~262,144   | 262,144 | NVIDIA hybrid Mamba-Transformer              |
| gpt-5-nano             | ~400,000   | 128,000 | OpenAI, smallest/cheapest GPT-5 variant      |
| qwen3.6-plus-free      | ~1,000,000 | 65,536  | Qwen, largest context among free models      |

Sources:

- [OpenCode Zen Documentation](https://opencode.ai/docs/zen/)
- [OpenAI GPT-5 Nano](https://platform.openai.com/docs/models/compare?model=gpt-5-nano) — 400K context
- [Qwen 3.6 Blog Post](https://qwen.ai/blog?id=qwen3.6) — 1M context
- [NVIDIA Nemotron 3 Super](https://developer.nvidia.com/blog/introducing-nemotron-3-super-an-open-hybrid-mamba-transformer-moe-for-agentic-reasoning/) — up to 1M context, ~262K practical default
- [OpenRouter Qwen 3.6 Plus](https://openrouter.ai/qwen/qwen3.6-plus:free) — 1M context, 65K output

## Solution

### 1. Default Model Change

Changed `DEFAULT_MODEL` from `opencode/minimax-m2.5-free` (~200K context) to `opencode/qwen3.6-plus-free` (~1M context).

**Rationale:** Qwen 3.6 Plus Free has the largest context window among free models (5x larger than minimax-m2.5-free), which means fewer compaction cycles and better long-running agent performance.

### 2. Compaction Models Cascade (`--compaction-models`)

New CLI option accepting a links notation references sequence:

```bash
agent --compaction-models "(big-pickle nemotron-3-super-free minimax-m2.5-free gpt-5-nano qwen3.6-plus-free same)"
```

**Default cascade:** `(big-pickle nemotron-3-super-free minimax-m2.5-free gpt-5-nano qwen3.6-plus-free same)`

**How the cascade works:**

1. When compaction is triggered, the system iterates through the cascade from first to last
2. For each model, it checks if the model's context limit can accommodate the current used tokens
3. If the context is too small, skip to the next model
4. If the model succeeds, compaction is complete
5. If the model fails (rate limit, error), try the next model in the cascade
6. `same` as the final entry means fall back to the base model

### 3. Links Notation Sequence Format

The `--compaction-models` value uses [links notation](https://www.npmjs.com/package/links-notation) sequence format:

- Parentheses `()` denote a sequence (ordered list)
- Space-separated items are the elements
- Each element is a model name (short name or `provider/model` format)
- The special value `same` means use the base model

### 4. Updated Provider Priority Lists

- `getSmallModel()`: Added `qwen3.6-plus-free` and `nemotron-3-super-free` to OpenCode priority list
- `sort()`: Added new models to sorting priority for model selection UI
- `resolveShortModelName()`: Comment updated to reflect new OpenCode-unique models

## Files Changed

| File                           | Change                                                              |
| ------------------------------ | ------------------------------------------------------------------- |
| `js/src/cli/defaults.ts`      | New DEFAULT_MODEL, added DEFAULT_COMPACTION_MODELS                  |
| `js/src/cli/argv.ts`          | Added `getCompactionModelsFromProcessArgv()`                        |
| `js/src/cli/run-options.js`   | Added `--compaction-models` CLI option                              |
| `js/src/cli/model-config.js`  | Links notation parser, cascade resolution, updated compaction config |
| `js/src/session/compaction.ts` | Added `CompactionModelEntry` interface, extended `CompactionModelConfig` |
| `js/src/session/prompt.ts`    | Cascade logic in compaction task handling                           |
| `js/src/session/message-v2.ts` | Extended zod schema for `compactionModels` array                   |
| `js/src/provider/provider.ts` | Updated priority lists for new free models                          |
| `FREE_MODELS.md`              | Added new models, updated recommendations                          |
| `MODELS.md`                   | Updated pricing table and default model info                        |
| `README.md`                   | Updated default model references                                    |

## Backward Compatibility

- `--compaction-model` (singular) still works and is respected when `--compaction-models` is not specified
- The `CompactionModelConfig.compactionModels` field is optional — existing serialized sessions without it work via the single-model fallback path
- All existing tests continue to pass with updated assertions for new defaults
