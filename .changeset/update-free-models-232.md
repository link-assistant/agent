---
"@link-assistant/agent": minor
---

feat: make qwen3.6-plus-free the default model, add compaction models cascade (#232)

- Change default model from `minimax-m2.5-free` to `qwen3.6-plus-free` (~1M context)
- Add `--compaction-models` CLI option for cascading compaction models
- Default cascade: `(big-pickle nemotron-3-super-free minimax-m2.5-free gpt-5-nano qwen3.6-plus-free same)`
- Add `nemotron-3-super-free` and `qwen3.6-plus-free` to free models lists
- Update documentation and provider priority lists
