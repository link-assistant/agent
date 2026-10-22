# Model discovery

New models come out every week. The agent avoids hard-coding them in two
ways (#334):

1. **models.dev catalogue.** The provider and model list, prices, context
   limits and capabilities are downloaded at runtime from
   [models.dev](https://models.dev/api.json), the same catalogue
   [OpenCode](https://github.com/anomalyco/opencode) uses. It is cached in
   `~/.cache/link-assistant-agent/models.json` (`$XDG_CACHE_HOME`) and
   refreshed when it is older than one hour.
2. **Live provider listings.** Each provider's own model-listing endpoint
   (`GET /models` and the like) says which models it serves right now, so a
   model released after the last models.dev update still works. models.dev
   only fills in metadata for such models.

The rules come from the model catalogue in
[hive-mind](https://github.com/link-assistant/hive-mind):

- listing requests never call an endpoint that spends tokens;
- results are cached for at least one hour;
- live listings decide what is available, models.dev adds metadata.

## Using it

```bash
# Models from the models.dev catalogue for every configured provider
agent models

# Add the models each provider's API lists right now
agent models --discover
agent models openrouter --discover

# Ignore every cache: refetch models.dev and the provider listings
agent models --refresh

# Only models that cost nothing
agent models --free
agent models --free --discover
agent models gpt4free --discover   # keyless providers work too
```

`--verbose` prints the full model record (limits, cost, modalities).

When a model passed with `--model provider/model` is not in the catalogue,
the agent:

1. refreshes models.dev;
2. checks the provider's live listing;
3. for routers and local servers (gpt4free, Pollinations, Ollama, vLLM,
   llama.cpp, LM Studio and others), passes the ID through unchanged;
4. otherwise fails with a clear error instead of using another model.

## Listing endpoints

| Provider package                                 | Listing request                                                                     | Auth header                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- | ---------------------------- |
| OpenAI-compatible (most providers, gpt4free etc) | `GET {baseURL}/models`                                                              | `Authorization`              |
| `@ai-sdk/anthropic`                              | `GET {baseURL}/models?limit=1000` with `anthropic-version: 2023-06-01`              | `x-api-key`                  |
| `@ai-sdk/google`                                 | `GET {baseURL}/models?pageSize=1000`                                                | `x-goog-api-key`             |
| `@ai-sdk/cohere`                                 | `GET https://api.cohere.com/v1/models?endpoint=chat&page_size=1000`                 | `Authorization`              |
| `@ai-sdk/azure`                                  | `GET https://{resource}.openai.azure.com/openai/deployments?api-version=2022-12-01` | `api-key` or Entra ID bearer |
| Vercel AI Gateway                                | `GET https://ai-gateway.vercel.sh/v1/models`                                        | `Authorization`              |
| Kilo                                             | `GET https://api.kilo.ai/api/gateway/models`                                        | `Authorization`              |

Notes:

- `{baseURL}` is the provider's `baseURL` option, its models.dev `api` URL
  (template variables such as `${CLOUDFLARE_ACCOUNT_ID}` resolved from the
  environment) or the SDK default.
- A URL whose template variables are not all set is skipped rather than
  requested half-filled.
- Providers whose login signs requests itself (OAuth logins, Azure Entra
  ID) list models through the same signing `fetch` they use for chat.
- The OpenAI-compatible parser understands OpenRouter-style pricing and
  modalities. It drops embedding, image-only and other non-chat models, and
  treats `:free` / `-free` IDs as free.
- **Azure:** model IDs are deployment names, so the agent lists the
  deployments of the resource and keeps those whose status is `succeeded`.
  Each deployment's underlying model (for example `gpt-4o`) is used to look
  up metadata. The resource comes from the `resourceName` option,
  `AZURE_RESOURCE_NAME` or the `agent auth login` Entra ID login. A custom
  non-Azure `baseURL` keeps the models.dev list. OpenCode additionally reads
  deployments through the Azure management API for Azure CLI logins; the
  agent uses only the data-plane listing above, which accepts both API keys
  and Entra ID tokens.
- No token-free listing: Amazon Bedrock, Google Vertex, Perplexity, GitLab
  Duo, Cloudflare AI Gateway and OpenCode Zen. These use the catalogue
  (Zen has its own free-model lookup).

### Billable endpoints are refused

Before any listing request, the URL path is checked against the endpoints
that spend tokens, and a match throws:

- `/v1/messages`
- `/v1/complete`
- `/chat/completions`
- `/completions`
- `/responses`
- `/embeddings`
- `:generateContent`
- `:streamGenerateContent`
- `:countTokens`
- `/v1/batches`

A misconfigured provider therefore cannot be charged by discovery.

## Caching and settings

Listings are cached in memory and in
`~/.cache/link-assistant-agent/model-discovery/` with a key built from the
provider, the listing URL and a hash of the credential header. Changing the
key or the endpoint therefore never reuses another account's list.

| Environment variable                               | Effect                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------ |
| `LINK_ASSISTANT_AGENT_MODEL_DISCOVERY`             | `0`, `false` or `off` disables live listings (models.dev is still used).       |
| `LINK_ASSISTANT_AGENT_MODEL_DISCOVERY_TTL_MINUTES` | Cache lifetime in minutes. Values below 60 are ignored: it can only be raised. |

Requests time out after 10 seconds. A failed listing never fails the run;
`agent models --discover` prints the error and the catalogue is used.

## Updating the docs

[providers.md](providers.md) has a generated table of every models.dev
provider. Regenerate it with:

```bash
bun scripts/generate-provider-docs.mjs          # fetch models.dev
bun scripts/generate-provider-docs.mjs --check  # exit 1 if outdated
```

Implementation: `js/src/provider/model-discovery.ts`,
`js/src/provider/models.ts` and `js/src/cli/cmd/models.ts`.
