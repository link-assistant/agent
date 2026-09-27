# Case Study: Issue #315 — Provider Identity and Host Config Contract

Umbrella for [#313](https://github.com/link-assistant/agent/issues/313) and [#314](https://github.com/link-assistant/agent/issues/314). Evidence: the 2026-09-27 Scala run with `--tool agent`, `@link-assistant/agent` 0.26.5 ([log gist](https://gist.github.com/konard/8a196a1d179ecb105304232a46e09ede)).

## #313 — a Formal AI run that the stream says used OpenCode

The run was `agent --model formalai/formal-ai --no-summarize-session --no-generate-title --verbose`. Nothing but Formal AI was called, yet within the first second the stream carried:

```text
[15:09:17.414Z] "service": "provider", "providerID": "opencode", "message": "found"
[15:09:17.414Z] 🛑 Formal AI attribution disabled: the Agent CLI stream reports opencode, a hosted opencode model
[15:09:17.415Z] "service": "provider", "modelID": "big-pickle", "providerID": "opencode", "message": "resolved short model name (single match)"
[15:09:17.416Z] "service": "provider", "modelID": "minimax-m2.5-free", "providerID": "kilo", "message": "resolved short model name (single match)"
[15:09:17.416Z] "model": "nemotron-3-super-free", "error": "ProviderModelNotFoundError", "message": "skipping unresolvable compaction model in cascade"
```

The host read `providerID` fields as provenance and turned attribution off.

### Root cause

1. `Provider.state()` logged `found` with `providerID` for every provider it enumerated.
2. `parseCompactionModelConfig` resolved every short name of the built-in compaction cascade (`big-pickle minimax-m2.5-free …`) across all providers, logging each match or failure. Only afterwards did the #307 narrowing drop the entries that were not on the `--model` provider. The run never used those resolutions, but their log records remained.

### Fix

- When the built-in cascade is narrowed to the `--model` provider anyway, entries are resolved against that provider's catalog only (`resolveEntryWithinProvider` in `js/src/cli/model-config.js`). Other providers are never looked up, so nothing is logged about them and no `ProviderModelNotFoundError` appears. A single `default compaction models narrowed to the configured provider` record lists the dropped names as written.
- Registry records move to the `provider-registry` service. They describe candidates as `name` / `candidate` / `available` rather than `providerID` / `modelID`, so a record carrying `providerID` means a provider that is actually in use.

Reproduction: `experiments/issue-315/provider-identity-in-stream.ts` (7 foreign records before, 0 after). Regression test: `js/tests/provider-identity-in-stream.ts`.

## #314 — `gh` unauthenticated inside the agent session

```text
[15:09:16.036Z] 🧠 Formal AI: config XDG_CONFIG_HOME=/home/box/.cache/hive-mind/formal-ai/agent-krM8Ep/.config, seeded /home/box/.config/link-assistant-agent → .config/link-assistant-agent
[15:09:20.903Z] "output": "To get started with GitHub CLI, please run:  gh auth login\n…"
```

### Root cause

To deliver the agent's config, the host relocated `XDG_CONFIG_HOME`. `gh` resolves its config as `$GH_CONFIG_DIR`, then `$XDG_CONFIG_HOME/gh`, then `~/.config/gh`. After the relocation it found no `hosts.yml`, so every `gh` call in a `bash` tool ran unauthenticated. The CLI already accepted `LINK_ASSISTANT_AGENT_CONFIG_DIR`, `LINK_ASSISTANT_AGENT_CONFIG` and `LINK_ASSISTANT_AGENT_CONFIG_CONTENT`, but they were undocumented and nothing flagged the relocation.

### Fix

- [docs/host-integration.md](../../host-integration.md) documents the three variables as the host contract, including their merge order, and says `XDG_CONFIG_HOME` must not be relocated.
- At startup, `HostConfigHint.detect` (`js/src/config/host-config-hint.ts`) checks whether `XDG_CONFIG_HOME` differs from `~/.config` while none of the three variables is set. If so, the CLI logs one `XDG_CONFIG_HOME is relocated` warning pointing at them.
- `js/tests/host-config-contract.ts`:
  - Unit tests for the detection.
  - An end-to-end run with a provider defined only in `LINK_ASSISTANT_AGENT_CONFIG_DIR`, whose `bash` tool call still reads the caller's `$XDG_CONFIG_HOME/gh/hosts.yml`.
  - The pre-#314 host setup reproduced: the tool call loses the gh config, and the warning is emitted.
  - Where the caller really is signed in to `gh` through its config, `gh auth status` inside the session exits 0.
