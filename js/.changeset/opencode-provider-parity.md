---
'@link-assistant/agent': minor
---

feat: support every AI provider OpenCode supports, plus gpt4free, with live model discovery (#334)

- Every [models.dev](https://models.dev) provider loads, including those
  whose base URLs use `${ENV}` templates (Cloudflare, Databricks, Snowflake
  Cortex, Vertex, Neon and others) and per-model endpoints. Ported OpenCode's
  custom loaders for Amazon Bedrock (including Mantle), Google Vertex,
  Cloudflare AI Gateway and Workers AI, Snowflake Cortex and SAP AI Core.
  Venice and AIHubMix fall back to their OpenAI-compatible endpoints.
- Ported OpenCode's subscription logins to `agent auth login`: xAI
  (SuperGrok), Poe, DigitalOcean, GitLab (gitlab.com and self-managed) and
  Azure Microsoft Entra ID through the Azure CLI. They join the existing
  Claude, ChatGPT, GitHub Copilot, Google, Qwen and Kilo logins.
- Sends `prompt_cache_key` to the openai-compatible providers OpenCode
  enables it for.
- New providers that models.dev does not list: `gpt4free` (local
  Interference API, `G4F_PROVIDER` pinning), `g4f-space`, `pollinations`,
  `airforce`, `aibadgr`, `api-route`, `cheaperinference`, `theb`, `ollama`,
  `vllm`, `llamacpp` and `omniroute`. Keyless ones are used only when named
  with `--model`.
- Live model discovery: each provider's own token-free listing endpoint
  (including Azure deployments) adds models released since the last
  models.dev update. The listing is cached for at least an hour, and
  endpoints that spend tokens are refused. Set
  `LINK_ASSISTANT_AGENT_MODEL_DISCOVERY=off` to turn it off.
- `agent models` gains `--discover`, `--refresh` and `--free`.
- New docs: `docs/providers.md`, with a generated table of all models.dev
  providers (`bun scripts/generate-provider-docs.mjs`),
  `docs/gpt4free.md` and `docs/model-discovery.md`. Refreshed `MODELS.md`
  and `FREE_MODELS.md` with current models.
