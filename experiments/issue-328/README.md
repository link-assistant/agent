# Withdrawn default model (#328)

`catalogue-evidence.json` records the relevant entries fetched from Zen and models.dev on October 12, 2026, including each source URL. MiniMax M2.5 Free, Nemotron 3 Super Free, Hy3 Preview Free, and Ling 2.6 Flash Free were absent from Zen and deprecated on models.dev.

From the repository root:

```bash
# Replay the evidence without network or inference calls.
bun experiments/issue-328/reproduce.ts

# Check shipped defaults against the current catalogues.
bun scripts/check-default-models.mjs

# Exercise the mocked regression and catalogue failure cases.
bun test ./js/tests/default-model-catalogue.ts
```

The replay reports four unavailable original models and zero unavailable current models. Before the fix, the live checker also failed with those four IDs and the regression suite had three failures. Catalogue checks validate model IDs; the separate Zen `FreeTierError` restriction reported in [issue #327](https://github.com/link-assistant/agent/issues/327#issuecomment-6040047705) can still prevent inference.
