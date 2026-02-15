---
'@link-assistant/agent': patch
---

Update free models: replace minimax-m2.1-free with minimax-m2.5-free

- Replace `minimax-m2.1-free` with `minimax-m2.5-free` in OpenCode Zen (M2.1 no longer free)
- Remove `glm-4.7-free` from free models (no longer available)
- Update Kilo Gateway free models: add GLM 4.5 Air, DeepSeek R1, update MiniMax to M2.5
- Update provider priority lists in `getSmallModel()` function
- Add FREE_MODELS.md comprehensive documentation

Breaking change: Users relying on `opencode/minimax-m2.1-free` or `opencode/glm-4.7-free`
should switch to `opencode/minimax-m2.5-free` or other free models listed in FREE_MODELS.md.
