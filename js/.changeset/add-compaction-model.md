---
'@link-assistant/agent': minor
---

Add --compaction-model (default: opencode/gpt-5-nano) and --compaction-safety-margin (default: 15%) CLI options. When the compaction model has a larger context window than the base model, the safety margin is automatically removed, allowing 100% usage of the base model's usable context. This extends effective working context by ~18% for free tier models at zero cost.
