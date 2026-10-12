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

## Dependency freshness follow-up

The latest-head CI run at `cf7c0dc` reproduced the existing freshness failures:
28 outdated JavaScript packages, the closed tree-sitter pin issue, and outdated
serde_json, tokio, and uuid. The same commands failed locally before the refresh
and passed after updating both JavaScript lockfiles and the three Rust crates.

`refresh-npm-dependencies.mjs` previews or updates unpinned direct packages using
the npm registry's current release metadata. It retains documented compatibility
pins and bounds registry concurrency to six requests:

```bash
node experiments/issue-328/refresh-npm-dependencies.mjs
# Add --write to update package.json, then regenerate both lockfiles.

cd js
npm ci --legacy-peer-deps --ignore-scripts
node ../scripts/check-npm-freshness.mjs
cd ../rust
cargo outdated --root-deps-only --exit-code 1
```

On October 12, OpenTUI 0.6.1 still declares exact peers for Solid 1.9.12 and
web-tree-sitter 0.25.10, and its published worker resolves the old runtime WASM
export. Their exceptions reference the open upstream issues
[Solid compatibility #689](https://github.com/anomalyco/opentui/issues/689) and
[current tree-sitter support #1550](https://github.com/anomalyco/opentui/issues/1550).
The freshness gate is unchanged. The
[packed parser experiment](../issue-322/README.md) verifies the supported runtime
and Agent's newer parser support while reproducing OpenTUI's peer conflict.
