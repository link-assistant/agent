---
'@link-assistant/agent': minor
---

feat: add --temperature CLI option for model completion override (#241)

- Added `--temperature` flag to JS and Rust CLI implementations
- When set, overrides per-model and per-agent temperature defaults
- When not set, existing behavior is unchanged
- Temperature flows through PromptInput schema and User message to AI SDK
- Priority chain: CLI --temperature > agent config > model defaults
