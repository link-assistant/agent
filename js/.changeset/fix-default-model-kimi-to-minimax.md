---
'@link-assistant/agent': patch
---

fix: centralize default model constant and update from kimi-k2.5-free to minimax-m2.5-free (#208)

The yargs default model in `index.js`, the OAuth fallback check in
`model-config.js`, and the task tool fallback in `task.ts` referenced
`opencode/kimi-k2.5-free`, which was discontinued on the OpenCode Zen
provider. Runs that did not pass `--model` explicitly (or where the
yargs caching bug #192 caused the CLI argument to be silently dropped)
would attempt to use the removed model and fail with a 401 ModelError.

Additionally, the default model was hardcoded in multiple files, making
future updates error-prone (as demonstrated by this issue).

Changes:

- `js/src/cli/defaults.ts`: new file exporting `DEFAULT_MODEL`,
  `DEFAULT_PROVIDER_ID`, and `DEFAULT_MODEL_ID` constants — the single
  source of truth for the default model
- `js/src/index.js`: import and use `DEFAULT_MODEL` constant for the
  `--model` yargs default
- `js/src/cli/model-config.js`: import and use `DEFAULT_PROVIDER_ID`
  and `DEFAULT_MODEL_ID` constants in the `--use-existing-claude-oauth`
  check and error messages
- `js/src/tool/task.ts`: import and use `DEFAULT_PROVIDER_ID` and
  `DEFAULT_MODEL_ID` constants as the fallback model
