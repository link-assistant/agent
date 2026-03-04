---
'@link-assistant/agent': patch
---

fix: update default model from kimi-k2.5-free to minimax-m2.5-free (#208)

The yargs default model in `index.js` and the OAuth fallback check in
`model-config.js` still referenced `opencode/kimi-k2.5-free`, which
was discontinued on the OpenCode Zen provider. As a result, runs that
did not pass `--model` explicitly (or where the yargs caching bug #192
caused the CLI argument to be silently dropped) would attempt to use
the removed model and fail immediately with a 401 ModelError.

Changes:

- `js/src/index.js`: update `--model` yargs default from
  `opencode/kimi-k2.5-free` to `opencode/minimax-m2.5-free`
- `js/src/cli/model-config.js`: update `--use-existing-claude-oauth`
  default-model check and related comments to reference
  `minimax-m2.5-free` instead of `kimi-k2.5-free`
