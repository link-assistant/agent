# Case Study: Add `--temperature` CLI Option

**Issue:** [#241](https://github.com/link-assistant/agent/issues/241)
**PR:** [#244](https://github.com/link-assistant/agent/pull/244)

## Problem Statement

The agent CLI lacked a user-facing `--temperature` option. Temperature was determined entirely by internal logic:
1. Model-level: `ProviderTransform.temperature()` returned hard-coded values per model family (e.g., Qwen: 0.55, Claude: `undefined`, Gemini 3 Pro: 1.0, others: 0).
2. Agent-level: Agent configuration files (`.link-assistant-agent/opencode.jsonc`) could override temperature per agent.
3. Model metadata gate: Temperature was only applied if `model.info.temperature === true`.

Users had no way to override temperature from the command line for quick experimentation or to tune outputs for specific tasks without editing configuration files.

## Requirements from Issue

1. **Add `--temperature` option** to the CLI.
2. **Preserve existing behavior when not set** ("if it is not set, we don't change current behavior at all").
3. **Collect data and produce a case study** in `./docs/case-studies/issue-241/`.

## Background: Temperature in LLM APIs

Temperature controls the randomness of token selection by scaling logit values before the softmax function converts them into probabilities. It is the single most important LLM sampling parameter.

### Temperature Ranges by Provider

| Provider | Model Examples | Valid Range |
| -------- | -------------- | ----------- |
| OpenAI | gpt-4o, o3 | 0.0 -- 2.0 |
| Anthropic | claude-4-opus | 0.0 -- 1.0 |
| Google | gemini-2.5-pro | 0.0 -- 2.0 |

### Recommended Values by Use Case

| Use Case | Temperature | Rationale |
| -------- | ----------- | --------- |
| Code generation, data extraction | 0.0 -- 0.2 | Deterministic, consistent |
| Balanced general tasks | 0.5 -- 0.7 | Good mix of coherence and variety |
| Creative writing, brainstorming | 0.8 -- 1.2 | Higher novelty and diversity |

### References

- [LLM Temperature Settings Guide (Tetrate)](https://tetrate.io/learn/ai/llm-temperature-guide)
- [What is LLM Temperature? (IBM)](https://www.ibm.com/think/topics/llm-temperature)
- [LLM Sampling Parameters Explained](https://letsdatascience.com/blog/llm-sampling-temperature-top-k-top-p-and-min-p-explained)
- [How to Choose the Right LLM Temperature (Promptfoo)](https://www.promptfoo.dev/docs/guides/evaluate-llm-temperature/)

## Existing Temperature Resolution (Before This Change)

```
model.info.temperature == true?
  ├─ YES → agent.temperature ?? ProviderTransform.temperature(providerID, modelID)
  └─ NO  → undefined (provider default)
```

### Per-Model Defaults in `ProviderTransform.temperature()`

| Model Family | Default Temperature |
| ------------ | ------------------- |
| Qwen* | 0.55 |
| Claude* | `undefined` (provider default) |
| Gemini 3 Pro | 1.0 |
| All others | 0 (deterministic) |

## Solution

### Architecture: CLI Temperature as Highest Priority Override

The new resolution chain is:

```
CLI --temperature is set?
  ├─ YES → use CLI value (bypasses model.info.temperature gate)
  └─ NO  → existing behavior:
           model.info.temperature == true?
             ├─ YES → agent.temperature ?? ProviderTransform.temperature(...)
             └─ NO  → undefined (provider default)
```

**Key design decision:** When `--temperature` is explicitly provided via CLI, it bypasses the `model.info.temperature` gate. This is intentional — the user is making an explicit override and should be able to set temperature even for models that don't normally expose it.

### Changes Made

| File | Change |
| ---- | ------ |
| `js/src/cli/run-options.js` | Added `--temperature` option (type: number, no default) |
| `js/src/session/prompt.ts` | Added `temperature` to `PromptInput` schema; CLI temperature takes priority in resolution |
| `js/src/session/message-v2.ts` | Added optional `temperature` field to `User` message schema |
| `js/src/index.js` | Passes `argv.temperature` through `runServerMode`, `runDirectMode`, continuous mode variants |
| `js/src/cli/continuous-mode.js` | Passes `temperature` through `runContinuousServerMode`, `runContinuousDirectMode` |
| `rust/src/cli.rs` | Added `--temperature` as `Option<f64>` to `Args` struct |

### Data Flow

```
CLI: --temperature 0.7
  → argv.temperature = 0.7
  → runServerMode/runDirectMode(... temperature)
  → SessionPrompt.prompt({ ..., temperature: 0.7 })
  → createUserMessage() stores temperature in User message
  → loop() reads lastUser.temperature
  → params.temperature = 0.7 (overrides all other sources)
  → AI SDK generateText({ temperature: 0.7, ... })
```

### Test Coverage

New test file: `js/tests/temperature-option.test.ts`

| Test | Assertion |
| ---- | --------- |
| run-options.js defines temperature option | Type is `number`, no default value |
| ProviderTransform.temperature defaults | Qwen=0.55, Claude=undefined, Gemini 3 Pro=1.0, others=0 |
| MessageV2.User schema with temperature | Accepts and correctly parses optional temperature field |
| SessionPrompt.PromptInput with temperature | Schema validates temperature field |
| Rust CLI temperature field | `Option<f64>` with `#[arg(long)]` attribute |

## Usage Examples

```bash
# Use default temperature (existing behavior, unchanged)
agent -p "Write a function to sort an array"

# Override temperature for more creative output
agent --temperature 0.8 -p "Write a poem about coding"

# Set temperature to 0 for deterministic output
agent --temperature 0 -p "Extract the date from this text: ..."

# Works with all other options
agent --temperature 0.5 --model opencode/gpt-5-nano -p "Explain recursion"

# Environment variable support (via lino-arguments)
LINK_ASSISTANT_AGENT_TEMPERATURE=0.7 agent -p "Hello"
```

## Risk Assessment

| Risk | Mitigation |
| ---- | ---------- |
| Breaking existing behavior | No default value — when unset, existing code paths are untouched |
| Invalid temperature values | Providers validate and return errors for out-of-range values |
| Interaction with agent config temperature | CLI explicitly overrides agent config (documented priority chain) |
