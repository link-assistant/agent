---
'@link-assistant/agent': patch
---

fix: keep other providers out of an explicit `--model` run, and document the host config contract

With an explicit `--model` on a non-default provider, the built-in compaction
cascade is resolved against that provider only: models nobody asked for are
never looked up, logged, or reported as `ProviderModelNotFoundError`, and
provider registry records (now under the `provider-registry` service) no
longer carry `providerID`/`modelID` fields for candidates (#313).

`LINK_ASSISTANT_AGENT_CONFIG_DIR`, `LINK_ASSISTANT_AGENT_CONFIG` and
`LINK_ASSISTANT_AGENT_CONFIG_CONTENT` are documented as the way a host
supplies configuration (`docs/host-integration.md`). The CLI warns at startup
when `XDG_CONFIG_HOME` is relocated without them, since that also hides
`gh`/`git` credentials from the agent's tool calls (#314).

Closes #315
