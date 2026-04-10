---
'@link-assistant/agent': minor
---

feat: replace deprecated qwen3.6-plus-free default with nemotron-3-super-free (#242)

- Default model changed from `qwen3.6-plus-free` to `nemotron-3-super-free` (~262K context, NVIDIA hybrid Mamba-Transformer)
- Removed `qwen3.6-plus-free` from compaction models cascade (free promotion ended April 2026)
- Updated provider priority lists to remove unavailable model
- Moved `qwen3.6-plus-free` to deprecated/discontinued sections in documentation
