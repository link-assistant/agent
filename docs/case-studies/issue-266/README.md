# Case Study: Update Free Models and Restore MiniMax M2.5 Free Default

**Issue:** [#266](https://github.com/link-assistant/agent/issues/266)
**PR:** [#267](https://github.com/link-assistant/agent/pull/267)
**Date:** 2026-04-23

## Problem Statement

The repository still treated `opencode/nemotron-3-super-free` as the default model after OpenCode Zen's free model set changed again. The issue requested a current free-model review, a default model change to **MiniMax M2.5 Free**, and a case study under `docs/case-studies/issue-266`.

## Requirements

| Requirement                                                | Resolution                                                                                               |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Read current OpenCode Zen model data                       | Checked OpenCode Zen docs and `https://opencode.ai/zen/v1/models` on 2026-04-23                          |
| Check models.dev freshness                                 | Checked `https://models.dev/api.json`; it includes current OpenCode free metadata and deprecation status |
| Update free model list                                     | Updated `FREE_MODELS.md`, `MODELS.md`, and JS README examples                                            |
| Set MiniMax M2.5 Free as default                           | Updated JS and Rust central defaults to `opencode/minimax-m2.5-free`                                     |
| Avoid frequent code edits for new manually selected models | Added a narrow OpenCode Zen live-model fallback for free models missing from models.dev                  |
| Add test coverage                                          | Updated default-model tests and added OpenCode Zen live endpoint unit tests                              |

## Current OpenCode Zen Free Models

Sources:

- [OpenCode Zen docs](https://opencode.ai/docs/zen/)
- `https://opencode.ai/zen/v1/models`
- [models.dev API](https://models.dev/api.json)
- [models.dev repository](https://github.com/anomalyco/models.dev)

| Model                 | Agent ID                         | Context |  Output | Notes                                  |
| --------------------- | -------------------------------- | ------: | ------: | -------------------------------------- |
| MiniMax M2.5 Free     | `opencode/minimax-m2.5-free`     | 204,800 | 131,072 | New default                            |
| Ling 2.6 Flash Free   | `opencode/ling-2.6-flash-free`   | 262,100 |  32,800 | Newly documented free model            |
| Hy3 Preview Free      | `opencode/hy3-preview-free`      | 256,000 |  64,000 | Newly documented free model            |
| Nemotron 3 Super Free | `opencode/nemotron-3-super-free` | 204,800 | 128,000 | Previous default                       |
| GPT 5 Nano            | `opencode/gpt-5-nano`            | 400,000 | 128,000 | Still used as default compaction model |
| Big Pickle            | `opencode/big-pickle`            | 200,000 | 128,000 | Stealth/free evaluation model          |

The live Zen models endpoint also listed `trinity-large-preview-free`, but models.dev marks it deprecated and the OpenCode Zen pricing section does not list it as a current free pricing row. It is not recommended in the docs.

## Root Cause

Defaults are intentionally hardcoded in `js/src/cli/defaults.ts` and `rust/src/cli.rs`, so the previous default stayed in effect until explicitly changed. The agent already refreshes models.dev dynamically, but explicit `opencode/<model>` validation could still reject a newly available free Zen model if models.dev temporarily lagged behind the Zen API.

## Solution

1. Changed JS and Rust defaults to `opencode/minimax-m2.5-free`.
2. Updated OpenCode provider priority so MiniMax M2.5 Free sorts first among free OpenCode models.
3. Removed `minimax-m2.5-free` from the Kilo-unique short-name list so the short name resolves to OpenCode first when both providers expose it.
4. Added `js/src/provider/opencode-zen.ts` to query `https://opencode.ai/zen/v1/models` and synthesize minimal metadata for live free Zen models that are not yet present in models.dev.
5. Updated the compaction fallback cascade and manual integration test model references to avoid retired OpenCode free models.
6. Updated free-model documentation with the current model set and source notes.

## Alternatives Considered

| Option                                    | Tradeoff                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Only change `DEFAULT_MODEL`               | Simple but leaves docs stale and does not address the issue's dynamic-data requirement                  |
| Trust only models.dev                     | Good metadata, but models.dev can lag behind live provider availability                                 |
| Trust only Zen `/models`                  | Fresh availability, but the endpoint currently returns model IDs without pricing/context metadata       |
| Merge models.dev with a Zen live fallback | Best balance: rich metadata from models.dev, live availability check for newly selected free Zen models |

## Verification Plan

- `bun test ./tests/compaction-model.test.ts`
- `bun test ./tests/opencode-zen-models.test.ts`
- `bun test ./tests/model-strict-validation.test.ts`
- `bun test tests/integration/models-cache.test.js`
- `bun test tests/integration/verbose-hi.test.js`
- `cargo test`
- `npm run check`
