# Providers

The agent reads its provider and model catalogue from
[models.dev](https://models.dev), the same catalogue
[OpenCode](https://github.com/anomalyco/opencode) uses. The catalogue is
downloaded at runtime and cached in `~/.cache/link-assistant-agent/models.json`.
New providers and models therefore show up without an agent release. On top of
models.dev the agent adds the [gpt4free](gpt4free.md) family, local inference
servers, and the provider-specific behaviour OpenCode implements in its
provider plugins.

Every provider is addressed as `--model <provider>/<model>`:

```bash
agent models                       # catalogue models of providers with credentials
agent models groq --discover       # plus what the provider lists right now
agent models --free --discover     # free models only
echo "hi" | agent --model groq/llama-3.3-70b-versatile
```

See [Model discovery](model-discovery.md) for live listings and
[Free models](../FREE_MODELS.md) for models that cost nothing.

## Credentials

A provider becomes active as soon as one of these is present:

1. **Environment variables** listed for the provider in the table below, for
   example `GROQ_API_KEY`. Variables that only fill a templated base URL or
   name an account, region or project (`CLOUDFLARE_ACCOUNT_ID`,
   `DATABRICKS_HOST`, `AZURE_RESOURCE_NAME`, `GOOGLE_VERTEX_PROJECT`, ...)
   are never sent as an API key. They are substituted into the URL, as in
   OpenCode.
2. **`agent auth login`**: stores an API key or a subscription login in
   `~/.local/share/link-assistant-agent/auth.json`.
3. **Config file** `provider.<id>.options` (`apiKey`, `baseURL`, `headers`, ...).

Keyless providers (gpt4free, Pollinations, local servers) never take over
default or short-name model resolution. Select them explicitly with
`--model <provider>/<model>`.

## Subscription and account logins

`agent auth login` offers these methods besides "Manually enter API Key":

| Provider                | Login                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `anthropic`             | Claude Pro/Max OAuth, or create an API key via OAuth                                      |
| `claude-oauth`          | Claude Code credentials (`agent auth claude`, see [Claude OAuth](claude-oauth.md))        |
| `openai`                | ChatGPT Plus/Pro OAuth                                                                    |
| `github-copilot`        | GitHub device login (github.com and GitHub Enterprise)                                    |
| `google`                | Google AI Pro/Ultra OAuth (see [Google OAuth](google-oauth.md))                           |
| `qwen-coder`, `alibaba` | Qwen Coder subscription OAuth                                                             |
| `kilo`                  | Kilo device authorization (see [Kilo](kilo.md))                                           |
| `xai`                   | SuperGrok subscription device login (token refreshed automatically)                       |
| `poe`                   | Poe browser login (PKCE)                                                                  |
| `digitalocean`          | DigitalOcean browser login                                                                |
| `gitlab`                | GitLab.com or self-managed GitLab OAuth (`GITLAB_INSTANCE_URL`, `GITLAB_OAUTH_CLIENT_ID`) |
| `azure`                 | Microsoft Entra ID through your Azure CLI session (`az login`)                            |

The Azure login stores only the resource name. Each request gets a cached
bearer token from `az account get-access-token`, using the
`https://cognitiveservices.azure.com` audience, or `https://ai.azure.com` for
Foundry project endpoints.

**Not ported:** OpenCode's _Console_ login (`opencode auth login` against
`opencode.ai`). It signs in to OpenCode's organisation control plane with
OpenCode's own client identity, so another client cannot use it. OpenCode Zen
models still work with `OPENCODE_API_KEY`.

## OpenCode parity

OpenCode keeps provider-specific behaviour in
[`packages/core/src/plugin/provider`](https://github.com/anomalyco/opencode/tree/dev/packages/core/src/plugin/provider).
Each plugin maps to the agent like this:

| OpenCode plugin                                          | Agent                                                                                                                                                                                  |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `amazon-bedrock`                                         | AWS credential chain or `AWS_BEARER_TOKEN_BEDROCK`, region prefixes for cross-region inference, Bedrock Mantle models                                                                  |
| `azure`                                                  | Responses/chat routing, Entra ID login, deployment discovery (`azure`, `azure-cognitive-services`)                                                                                     |
| `cerebras`                                               | `X-Cerebras-3rd-Party-Integration` header                                                                                                                                              |
| `chatgpt`, `openai`                                      | ChatGPT Plus/Pro OAuth, Responses API                                                                                                                                                  |
| `cloudflare-workers-ai`                                  | `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_KEY` / `CLOUDFLARE_WORKERS_AI_TOKEN` / `CLOUDFLARE_API_TOKEN`                                                                                |
| `cloudflare-ai-gateway`                                  | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_GATEWAY_ID`, `CLOUDFLARE_API_TOKEN` / `CF_AIG_TOKEN`, `cf-aig-*` headers                                                                          |
| `cohere`, `perplexity`                                   | Native SDKs (Cohere models are also listed live)                                                                                                                                       |
| `databricks`, `neon`                                     | Templated endpoints (`DATABRICKS_HOST`, `NEON_AI_GATEWAY_BASE_URL`), only the token is a credential                                                                                    |
| `digitalocean`, `gitlab`, `poe`, `xai`                   | Subscription logins above                                                                                                                                                              |
| `dynamic`                                                | SDK packages outside the bundle are installed on first use; packages that do not load with the bundled AI SDK fall back to their OpenAI-compatible endpoint (Venice, AIHubMix)         |
| `github-copilot`                                         | Copilot login, chat and Responses models                                                                                                                                               |
| `google-vertex`                                          | `GOOGLE_VERTEX_PROJECT` / `GOOGLE_CLOUD_PROJECT`, location, Application Default Credentials or `GOOGLE_VERTEX_API_KEY`; Gemini, Anthropic and OpenAI-compatible models in one provider |
| `kilo`, `opencode`                                       | Kilo Gateway and OpenCode Zen with live free-model lookups                                                                                                                             |
| `llmgateway`, `nvidia`, `openrouter`, `vercel`, `zenmux` | Attribution headers                                                                                                                                                                    |
| `lmstudio`, `ollama`, `vllm`, `local`                    | Local servers, live model lists (see below)                                                                                                                                            |
| `modal`                                                  | `MODAL_PROXY_TOKEN`, models listed from the configured base URL                                                                                                                        |
| `prompt-cache-key`                                       | `prompt_cache_key` = session ID for the same OpenAI-compatible providers                                                                                                               |
| `sap-ai-core`                                            | `AICORE_SERVICE_KEY`, `AICORE_DEPLOYMENT_ID`, `AICORE_RESOURCE_GROUP`                                                                                                                  |
| `snowflake-cortex`                                       | `SNOWFLAKE_ACCOUNT`, `SNOWFLAKE_CORTEX_TOKEN` / `SNOWFLAKE_CORTEX_PAT`, stream termination fix                                                                                         |

## Providers outside models.dev

| ID                 | What                                           | Base URL (override)                                            | Key                        |
| ------------------ | ---------------------------------------------- | -------------------------------------------------------------- | -------------------------- |
| `gpt4free` (`g4f`) | Local [gpt4free](gpt4free.md) Interference API | `http://localhost:1337/v1` (`G4F_BASE_URL`)                    | optional                   |
| `g4f-space`        | Hosted gpt4free gateway                        | `https://g4f.space/v1` (`G4F_SPACE_BASE_URL`)                  | optional                   |
| `pollinations`     | Pollinations text models                       | `https://gen.pollinations.ai/v1` (`POLLINATIONS_BASE_URL`)     | optional                   |
| `airforce`         | api.airforce                                   | `https://api.airforce/v1`                                      | `AIRFORCE_API_KEY`         |
| `aibadgr`          | AI Badgr                                       | `https://aibadgr.com/api/v1`                                   | `AIBADGR_API_KEY`          |
| `api-route`        | APIRoute                                       | `https://global.api-route.com/v1`                              | `APIROUTE_API_KEY`         |
| `cheaperinference` | CheaperInference                               | `https://api.cheaperinference.com/v1`                          | `CHEAPERINFERENCE_API_KEY` |
| `theb`             | TheB.AI                                        | `https://api.theb.ai/v1`                                       | `THEB_API_KEY`             |
| `ollama`           | Ollama                                         | `http://127.0.0.1:11434/v1` (`OLLAMA_BASE_URL`, `OLLAMA_HOST`) | none                       |
| `vllm`             | vLLM                                           | `http://127.0.0.1:8000/v1` (`VLLM_BASE_URL`)                   | optional                   |
| `llamacpp`         | llama.cpp server                               | `http://127.0.0.1:8080/v1` (`LLAMACPP_BASE_URL`)               | optional                   |
| `omniroute`        | OmniRoute                                      | `http://localhost:20128/v1` (`OMNIROUTE_BASE_URL`)             | optional                   |
| `lmstudio`         | LM Studio (models.dev entry, made keyless)     | models.dev default (`LMSTUDIO_BASE_URL`)                       | none                       |

If models.dev ever adds one of these IDs, its entry wins.

## All models.dev providers

This snapshot comes from `bun scripts/generate-provider-docs.mjs`. "Free"
counts catalogue models priced at zero. "Login" marks providers with an
`agent auth login` method. The agent always uses the live catalogue, so run
`agent models` for the current list.

<!-- providers:start -->

232 providers.

| ID                         | Name                            | Env vars                                                                               | Models | Free | Login |
| -------------------------- | ------------------------------- | -------------------------------------------------------------------------------------- | -----: | ---: | ----- |
| `302ai`                    | 302.AI                          | `302AI_API_KEY`                                                                        |    125 |    0 |       |
| `abacus`                   | Abacus                          | `ABACUS_API_KEY`                                                                       |    108 |    0 |       |
| `abliteration-ai`          | abliteration.ai                 | `ABLIT_KEY`                                                                            |      3 |    0 |       |
| `above`                    | above.dev                       | `ABOVE_API_KEY`                                                                        |     10 |    0 |       |
| `agentrouter`              | AgentRouter                     | `AGENTROUTER_API_KEY`                                                                  |      5 |    0 |       |
| `agnes`                    | Agnes AI                        | `AGNES_API_KEY`                                                                        |      4 |    3 |       |
| `ai-router`                | AI-ROUTER                       | `AI_ROUTER_API_KEY`                                                                    |      5 |    0 |       |
| `ai21`                     | AI21 Labs                       | `AI21_API_KEY`                                                                         |      2 |    0 |       |
| `aiand`                    | ai&                             | `AIAND_API_KEY`                                                                        |     13 |    0 |       |
| `aihubmix`                 | AIHubMix                        | `AIHUBMIX_API_KEY`                                                                     |    155 |   17 |       |
| `aimlapi`                  | AI/ML API                       | `AIMLAPI_API_KEY`                                                                      |    177 |    0 |       |
| `ainetcafe`                | ainetcafe                       | `AINETCAFE_API_KEY`                                                                    |      1 |    0 |       |
| `aixy`                     | Aixy                            | `AIXY_API_KEY`                                                                         |     13 |    0 |       |
| `aki-io`                   | AKI.IO                          | `AKI_IO_API_KEY`                                                                       |      7 |    0 |       |
| `alibaba`                  | Alibaba                         | `DASHSCOPE_API_KEY`                                                                    |     59 |    0 | yes   |
| `alibaba-cn`               | Alibaba (China)                 | `DASHSCOPE_API_KEY`                                                                    |     91 |    2 |       |
| `alibaba-coding-plan`      | Alibaba Coding Plan             | `ALIBABA_CODING_PLAN_API_KEY`                                                          |     10 |   10 |       |
| `alibaba-coding-plan-cn`   | Alibaba Coding Plan (China)     | `ALIBABA_CODING_PLAN_API_KEY`                                                          |     10 |   10 |       |
| `alibaba-token-plan`       | Alibaba Token Plan              | `ALIBABA_TOKEN_PLAN_API_KEY`                                                           |     29 |   29 |       |
| `alibaba-token-plan-cn`    | Alibaba Token Plan (China)      | `ALIBABA_TOKEN_PLAN_API_KEY`                                                           |     29 |   29 |       |
| `amazon-bedrock`           | Amazon Bedrock                  | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_BEARER_TOKEN_BEDROCK` |    199 |    0 |       |
| `ambient`                  | Ambient                         | `AMBIENT_API_KEY`                                                                      |     17 |    0 |       |
| `amd`                      | AMD                             | `AMD_API_KEY`                                                                          |     11 |   11 |       |
| `anthropic`                | Anthropic                       | `ANTHROPIC_API_KEY`                                                                    |     17 |    0 | yes   |
| `anyapi`                   | AnyAPI                          | `ANYAPI_API_KEY`                                                                       |     30 |    0 |       |
| `arcee`                    | Arcee                           | `ARCEE_API_KEY`                                                                        |     11 |    0 |       |
| `atomic-chat`              | Atomic Chat                     | `ATOMIC_CHAT_API_KEY`                                                                  |      5 |    5 |       |
| `auriko`                   | Auriko                          | `AURIKO_API_KEY`                                                                       |     15 |    0 |       |
| `azure`                    | Azure                           | `AZURE_RESOURCE_NAME`, `AZURE_API_KEY`                                                 |     97 |    0 | yes   |
| `azure-cognitive-services` | Azure Cognitive Services        | `AZURE_COGNITIVE_SERVICES_RESOURCE_NAME`, `AZURE_COGNITIVE_SERVICES_API_KEY`           |     97 |    0 |       |
| `bailing`                  | Bailing                         | `BAILING_API_TOKEN`                                                                    |      2 |    0 |       |
| `baseten`                  | Baseten                         | `BASETEN_API_KEY`                                                                      |     26 |    0 |       |
| `bee`                      | Bee by HEOSSI                   | `BEE_API_KEY`                                                                          |      6 |    0 |       |
| `berget`                   | Berget.AI                       | `BERGET_API_KEY`                                                                       |      6 |    0 |       |
| `blueclaw`                 | Blue Claw                       | `BLUECLAW_API_KEY`                                                                     |      1 |    0 |       |
| `bothub`                   | Bothub                          | `BOTHUB_API_KEY`                                                                       |      8 |    2 |       |
| `boundless`                | Boundless                       | `BOUNDLESS_API_KEY`                                                                    |     20 |    0 |       |
| `cerebras`                 | Cerebras                        | `CEREBRAS_API_KEY`                                                                     |      2 |    0 |       |
| `chutes`                   | Chutes                          | `CHUTES_API_KEY`                                                                       |     14 |    0 |       |
| `clarifai`                 | Clarifai                        | `CLARIFAI_PAT`                                                                         |     12 |    0 |       |
| `claudinio`                | Claudinio                       | `CLAUDINIO_API_KEY`                                                                    |      2 |    0 |       |
| `cline-pass`               | ClinePass                       | `CLINE_API_KEY`                                                                        |     18 |    0 |       |
| `cloudferro-sherlock`      | CloudFerro Sherlock             | `CLOUDFERRO_SHERLOCK_API_KEY`                                                          |      5 |    0 |       |
| `cloudflare-ai-gateway`    | Cloudflare AI Gateway           | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_GATEWAY_ID`               |     72 |    1 |       |
| `cloudflare-workers-ai`    | Cloudflare Workers AI           | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_KEY`                                          |     28 |    0 |       |
| `cohere`                   | Cohere                          | `COHERE_API_KEY`                                                                       |     17 |    2 |       |
| `commandcode`              | CommandCode                     | `CMD_API_KEY`                                                                          |     71 |    1 |       |
| `coralbricks`              | CoralBricks                     | `CORAL_API_KEY`                                                                        |      1 |    0 |       |
| `cortecs`                  | Cortecs                         | `CORTECS_API_KEY`                                                                      |    106 |    2 |       |
| `crossmodel`               | CrossModel                      | `CROSSMODEL_API_KEY`                                                                   |     68 |    0 |       |
| `crusoe`                   | Crusoe                          | `CRUSOE_API_KEY`                                                                       |     11 |    0 |       |
| `daoxe`                    | DaoXE                           | `DAOXE_API_KEY`                                                                        |      9 |    0 |       |
| `databricks`               | Databricks                      | `DATABRICKS_HOST`, `DATABRICKS_TOKEN`                                                  |     31 |    0 |       |
| `deepinfra`                | Deep Infra                      | `DEEPINFRA_API_KEY`                                                                    |     77 |    0 |       |
| `deepseek`                 | DeepSeek                        | `DEEPSEEK_API_KEY`                                                                     |      4 |    0 |       |
| `digitalocean`             | DigitalOcean                    | `DIGITALOCEAN_ACCESS_TOKEN`                                                            |    104 |    0 | yes   |
| `dinference`               | DInference                      | `DINFERENCE_API_KEY`                                                                   |      6 |    0 |       |
| `drun`                     | D.Run (China)                   | `DRUN_API_KEY`                                                                         |      3 |    0 |       |
| `ebcloud`                  | EBCloud                         | `EBCLOUD_API_KEY`                                                                      |      4 |    0 |       |
| `echo`                     | Echo                            | `ECHO_API_KEY`                                                                         |      1 |    0 |       |
| `edenai`                   | Eden AI                         | `EDENAI_API_KEY`                                                                       |    360 |    0 |       |
| `empiriolabs`              | EmpirioLabs AI                  | `EMPIRIOLABS_API_KEY`                                                                  |     63 |    4 |       |
| `engy`                     | engy                            | `ENGY_API_KEY`                                                                         |      9 |    0 |       |
| `evroc`                    | evroc                           | `EVROC_API_KEY`                                                                        |     16 |    0 |       |
| `fastrouter`               | FastRouter                      | `FASTROUTER_API_KEY`                                                                   |     44 |    0 |       |
| `fireworks-ai`             | Fireworks AI                    | `FIREWORKS_API_KEY`                                                                    |     26 |    0 |       |
| `freemodel`                | FreeModel                       | `FREEMODEL_API_KEY`                                                                    |     10 |    0 |       |
| `friendli`                 | Friendli                        | `FRIENDLI_TOKEN`                                                                       |      6 |    0 |       |
| `frogbot`                  | FrogBot                         | `FROGBOT_API_KEY`                                                                      |     26 |    0 |       |
| `github-copilot`           | GitHub Copilot                  | `GITHUB_TOKEN`                                                                         |     36 |    0 | yes   |
| `gitlab`                   | GitLab Duo                      | `GITLAB_TOKEN`                                                                         |     30 |   30 | yes   |
| `gmicloud`                 | GMI Cloud                       | `GMICLOUD_API_KEY`                                                                     |     17 |    0 |       |
| `google`                   | Google                          | `GOOGLE_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `GEMINI_API_KEY`                     |     41 |    2 | yes   |
| `google-vertex`            | Vertex                          | `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_LOCATION`, `GOOGLE_APPLICATION_CREDENTIALS`    |     61 |    0 |       |
| `google-vertex-anthropic`  | Vertex (Anthropic)              | `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_LOCATION`, `GOOGLE_APPLICATION_CREDENTIALS`    |     17 |    0 |       |
| `greenpt`                  | GreenPT                         | `GREENPT_API_KEY`                                                                      |     40 |    0 |       |
| `groq`                     | Groq                            | `GROQ_API_KEY`                                                                         |     16 |    1 |       |
| `helicone`                 | Helicone                        | `HELICONE_API_KEY`                                                                     |     90 |    0 |       |
| `hetzner`                  | Hetzner                         | `HETZNER_API_KEY`                                                                      |      2 |    2 |       |
| `hpc-ai`                   | HPC-AI                          | `HPC_AI_API_KEY`                                                                       |      9 |    0 |       |
| `huggingface`              | Hugging Face                    | `HF_TOKEN`                                                                             |     84 |    1 |       |
| `hyper`                    | Charm Hyper                     | `HYPER_API_KEY`                                                                        |     23 |    0 |       |
| `iflowcn`                  | iFlow                           | `IFLOW_API_KEY`                                                                        |     14 |   14 |       |
| `impossibl`                | Impossibl                       | `IMPOSSIBL_API_KEY`                                                                    |     76 |    0 |       |
| `inception`                | Inception                       | `INCEPTION_API_KEY`                                                                    |      4 |    0 |       |
| `inceptron`                | Inceptron                       | `INCEPTRON_API_KEY`                                                                    |      6 |    0 |       |
| `inco`                     | Inco                            | `INCO_API_KEY`                                                                         |      7 |    0 |       |
| `infer`                    | Infer by Flow7                  | `INFER_API_KEY`                                                                        |      2 |    0 |       |
| `inference`                | Inference                       | `INFERENCE_API_KEY`                                                                    |      9 |    0 |       |
| `inferx`                   | InferX                          | `INFERX_API_KEY`                                                                       |     12 |   12 |       |
| `infomaniak`               | Infomaniak                      | `INFOMANIAK_API_KEY`, `INFOMANIAK_PRODUCT_ID`                                          |     10 |    1 |       |
| `io-net`                   | IO.NET                          | `IOINTELLIGENCE_API_KEY`                                                               |     17 |    0 |       |
| `iteracompute`             | IteraCompute                    | `ITERACOMPUTE_API_KEY`                                                                 |     10 |    1 |       |
| `jalapeno`                 | Jalapeno Cloud                  | `JALAPENO_API_KEY`                                                                     |     17 |    0 |       |
| `jiekou`                   | Jiekou.AI                       | `JIEKOU_API_KEY`                                                                       |     61 |    0 |       |
| `kenari`                   | Kenari                          | `KENARI_API_KEY`                                                                       |     64 |   10 |       |
| `kilo`                     | Kilo Gateway                    | `KILO_API_KEY`                                                                         |    397 |   22 | yes   |
| `kimi-code-plan-cn`        | Kimi For Coding (kimi.com)      | `KIMI_API_KEY`                                                                         |      4 |    4 |       |
| `kimi-code-plan-global`    | Kimi For Coding (kimi.ai)       | `KIMI_API_KEY`                                                                         |      4 |    4 |       |
| `klokintegration`          | klokintegration.se              | `KLOKINTEGRATION_API_KEY`                                                              |      3 |    0 |       |
| `kosmik`                   | Kosmik Compute                  | `KOSMIK_API_KEY`                                                                       |      1 |    0 |       |
| `kuae-cloud-coding-plan`   | KUAE Cloud Coding Plan          | `KUAE_API_KEY`                                                                         |      1 |    1 |       |
| `lilac`                    | Lilac                           | `LILAC_API_KEY`                                                                        |      4 |    0 |       |
| `liquid`                   | Liquid Inference                | `LIQUID_API_KEY`                                                                       |      1 |    0 |       |
| `llama`                    | Llama                           | `LLAMA_API_KEY`                                                                        |      7 |    7 |       |
| `llmgateway`               | DevPass (LLM Gateway)           | `LLMGATEWAY_API_KEY`                                                                   |    214 |    4 |       |
| `llmgateway-providers`     | LLM Gateway                     | `LLMGATEWAY_API_KEY`                                                                   |    433 |    2 |       |
| `llmtech`                  | LLM Tech                        | `LLMTECH_API_KEY`                                                                      |      1 |    0 |       |
| `llmtr`                    | LLMTR                           | `LLMTR_API_KEY`                                                                        |     32 |    1 |       |
| `lmstudio`                 | LMStudio                        | `LMSTUDIO_API_KEY`                                                                     |      3 |    3 |       |
| `longcat`                  | LongCat                         | `LONGCAT_API_KEY`                                                                      |      2 |    0 |       |
| `lowrouter`                | LowRouter                       | `LOWROUTER_API_KEY`                                                                    |     31 |    0 |       |
| `lucidquery`               | LucidQuery                      | `LUCIDQUERY_API_KEY`                                                                   |      4 |    0 |       |
| `lynkr`                    | Lynkr                           | `LYNKR_API_KEY`                                                                        |      1 |    1 |       |
| `meganova`                 | Meganova                        | `MEGANOVA_API_KEY`                                                                     |     19 |    1 |       |
| `melious`                  | Melious                         | `MELIOUS_API_KEY`                                                                      |     13 |    0 |       |
| `merge-gateway`            | Merge Gateway                   | `MERGE_GATEWAY_API_KEY`                                                                |    211 |    1 |       |
| `meta`                     | Meta                            | `META_MODEL_API_KEY`                                                                   |      6 |    0 |       |
| `minimax`                  | MiniMax (minimax.io)            | `MINIMAX_API_KEY`                                                                      |      8 |    0 |       |
| `minimax-cn`               | MiniMax (minimax.cn)            | `MINIMAX_API_KEY`                                                                      |      8 |    0 |       |
| `minimax-cn-coding-plan`   | MiniMax Token Plan (minimax.cn) | `MINIMAX_API_KEY`                                                                      |      9 |    9 |       |
| `minimax-coding-plan`      | MiniMax Token Plan (minimax.io) | `MINIMAX_API_KEY`                                                                      |      9 |    9 |       |
| `mistral`                  | Mistral                         | `MISTRAL_API_KEY`                                                                      |     39 |    2 |       |
| `mixlayer`                 | Mixlayer                        | `MIXLAYER_API_KEY`                                                                     |      5 |    0 |       |
| `moark`                    | Moark                           | `MOARK_API_KEY`                                                                        |     10 |    0 |       |
| `modal`                    | Modal                           | `MODAL_PROXY_TOKEN`                                                                    |      8 |    0 |       |
| `model-oracle-ai`          | Model Oracle AI                 | `MODEL_ORACLE_API_KEY`                                                                 |     15 |    0 |       |
| `modelis`                  | Modelis                         | `MODELIS_API_KEY`                                                                      |      9 |    0 |       |
| `modelscope`               | ModelScope                      | `MODELSCOPE_API_KEY`                                                                   |      7 |    7 |       |
| `moonshotai`               | Moonshot AI                     | `MOONSHOT_API_KEY`                                                                     |      4 |    0 |       |
| `moonshotai-cn`            | Moonshot AI (China)             | `MOONSHOT_API_KEY`                                                                     |      4 |    0 |       |
| `morph`                    | Morph                           | `MORPH_API_KEY`                                                                        |      3 |    0 |       |
| `nan`                      | NaN                             | `NAN_API_KEY`                                                                          |      8 |    8 |       |
| `nano-gpt`                 | NanoGPT                         | `NANO_GPT_API_KEY`                                                                     |    624 |    2 |       |
| `nearai`                   | NEAR AI Cloud                   | `NEARAI_API_KEY`                                                                       |     56 |    0 |       |
| `nebius`                   | Nebius Token Factory            | `NEBIUS_API_KEY`                                                                       |     24 |    0 |       |
| `neon`                     | Neon                            | `NEON_AI_GATEWAY_BASE_URL`, `NEON_AI_GATEWAY_TOKEN`                                    |     57 |    0 |       |
| `neosmith`                 | NeoSmith                        | `NEOSMITH_API_KEY`                                                                     |      4 |    0 |       |
| `neuralwatt`               | Neuralwatt                      | `NEURALWATT_API_KEY`                                                                   |     31 |    0 |       |
| `nova`                     | Nova                            | `NOVA_API_KEY`                                                                         |      2 |    2 |       |
| `novita-ai`                | Novita AI                       | `NOVITA_API_KEY`                                                                       |     86 |    1 |       |
| `nvidia`                   | Nvidia                          | `NVIDIA_API_KEY`                                                                       |     51 |   51 |       |
| `oci`                      | OCI Generative AI               | `OCI_GENAI_API_KEY`                                                                    |      9 |    0 |       |
| `ofox`                     | Ofox                            | `OFOX_API_KEY`                                                                         |    154 |    0 |       |
| `ollama-cloud`             | Ollama Cloud                    | `OLLAMA_API_KEY`                                                                       |     29 |    0 |       |
| `openai`                   | OpenAI                          | `OPENAI_API_KEY`                                                                       |     51 |    0 | yes   |
| `opencode`                 | OpenCode                        | `OPENCODE_API_KEY`                                                                     |    130 |   46 |       |
| `opencode-go`              | OpenCode Go                     | `OPENCODE_API_KEY`                                                                     |     34 |    5 |       |
| `openreason`               | OpenReason                      | `OPENREASON_API_KEY`                                                                   |      3 |    0 |       |
| `openrouter`               | OpenRouter                      | `OPENROUTER_API_KEY`                                                                   |    390 |   20 |       |
| `opper`                    | Opper                           | `OPPER_API_KEY`                                                                        |     57 |    0 |       |
| `orcarouter`               | OrcaRouter                      | `ORCAROUTER_API_KEY`                                                                   |    117 |    5 |       |
| `ovhcloud`                 | OVHcloud AI Endpoints           | `OVHCLOUD_API_KEY`                                                                     |     12 |    2 |       |
| `pareto`                   | Pareto Inference                | `PARETO_API_KEY`                                                                       |      1 |    0 |       |
| `pendra`                   | Pendra                          | `PENDRA_API_KEY`                                                                       |      6 |    6 |       |
| `perplexity`               | Perplexity                      | `PERPLEXITY_API_KEY`                                                                   |      4 |    0 |       |
| `perplexity-agent`         | Perplexity Agent                | `PERPLEXITY_API_KEY`                                                                   |     47 |    0 |       |
| `pioneer`                  | Pioneer                         | `PIONEER_API_KEY`                                                                      |    117 |    0 |       |
| `poe`                      | Poe                             | `POE_API_KEY`                                                                          |    142 |    3 | yes   |
| `poolside`                 | Poolside                        | `POOLSIDE_API_KEY`                                                                     |      3 |    3 |       |
| `prime`                    | Prime Inference                 | `PRIME_API_KEY`                                                                        |     69 |    0 |       |
| `privatemode-ai`           | Privatemode AI                  | `PRIVATEMODE_API_KEY`                                                                  |     11 |    0 |       |
| `qihang-ai`                | QiHang                          | `QIHANG_API_KEY`                                                                       |      9 |    0 |       |
| `qiniu-ai`                 | Qiniu                           | `QINIU_API_KEY`                                                                        |     91 |    1 |       |
| `qvac`                     | QVAC                            | `QVAC_API_KEY`                                                                         |      9 |    9 |       |
| `reflection`               | Reflection                      | `REFLECTION_API_KEY`                                                                   |      1 |    1 |       |
| `regolo-ai`                | Regolo AI                       | `REGOLO_API_KEY`                                                                       |     18 |    3 |       |
| `requesty`                 | Requesty                        | `REQUESTY_API_KEY`                                                                     |    180 |   12 |       |
| `routing-run`              | routing.run                     | `ROUTING_RUN_API_KEY`                                                                  |     15 |    0 |       |
| `runinfra`                 | RunInfra                        | `RUNINFRA_GATEWAY_KEY`                                                                 |      8 |    0 |       |
| `sakana`                   | Sakana AI                       | `SAKANA_API_KEY`                                                                       |      4 |    0 |       |
| `salad-cloud`              | SaladCloud AI Gateway           | `SALAD_CLOUD_API_KEY`                                                                  |      1 |    0 |       |
| `sambanova`                | SambaNova                       | `SAMBANOVA_API_KEY`                                                                    |      6 |    0 |       |
| `sap-ai-core`              | SAP AI Core                     | `AICORE_SERVICE_KEY`                                                                   |     55 |    0 |       |
| `sarvam`                   | Sarvam AI                       | `SARVAM_API_KEY`                                                                       |      2 |    0 |       |
| `scaleway`                 | Scaleway                        | `SCALEWAY_API_KEY`                                                                     |     17 |    0 |       |
| `scnet-token-plan`         | SCNet Token Plan                | `SCNET_API_KEY`                                                                        |     19 |   19 |       |
| `scx-ai`                   | SCX.ai                          | `SCX_API_KEY`                                                                          |      4 |    0 |       |
| `sensenova`                | SenseNova (China)               | `SENSENOVA_API_KEY`                                                                    |      6 |    6 |       |
| `siliconflow`              | SiliconFlow                     | `SILICONFLOW_API_KEY`                                                                  |     57 |    0 |       |
| `siliconflow-cn`           | SiliconFlow (China)             | `SILICONFLOW_CN_API_KEY`                                                               |     44 |    5 |       |
| `snowflake-cortex`         | Snowflake Cortex                | `SNOWFLAKE_ACCOUNT`, `SNOWFLAKE_CORTEX_PAT`                                            |     25 |    0 |       |
| `stackit`                  | STACKIT                         | `STACKIT_API_KEY`                                                                      |      8 |    0 |       |
| `standardcompute`          | Standard Compute                | `STANDARDCOMPUTE_API_KEY`                                                              |     40 |    0 |       |
| `stepfun`                  | StepFun (China)                 | `STEPFUN_API_KEY`                                                                      |      9 |    0 |       |
| `stepfun-ai`               | StepFun (Global)                | `STEPFUN_API_KEY`                                                                      |      9 |    0 |       |
| `stepfun-ai-step-plan`     | StepFun Step Plan (Global)      | `STEPFUN_API_KEY`                                                                      |      4 |    0 |       |
| `stepfun-step-plan`        | StepFun Step Plan (China)       | `STEPFUN_API_KEY`                                                                      |      5 |    0 |       |
| `subconscious`             | Subconscious                    | `SUBCONSCIOUS_API_KEY`                                                                 |      2 |    0 |       |
| `submodel`                 | submodel                        | `SUBMODEL_INSTAGEN_ACCESS_KEY`                                                         |      9 |    0 |       |
| `synthetic`                | Synthetic                       | `SYNTHETIC_API_KEY`                                                                    |     12 |    0 |       |
| `tempr`                    | Tempr Gateway                   | `TEMPR_API_KEY`                                                                        |     82 |    4 |       |
| `tencent-coding-plan`      | Tencent Coding Plan (China)     | `TENCENT_CODING_PLAN_API_KEY`                                                          |      8 |    8 |       |
| `tencent-token-plan`       | Tencent Token Plan              | `TENCENT_TOKEN_PLAN_API_KEY`                                                           |      2 |    1 |       |
| `tencent-tokenhub`         | Tencent TokenHub                | `TENCENT_TOKENHUB_API_KEY`                                                             |      3 |    2 |       |
| `tensorx`                  | TensorX                         | `TENSORX_API_KEY`                                                                      |     25 |    0 |       |
| `the-grid-ai`              | The Grid AI                     | `THEGRID_API_KEY`                                                                      |     17 |    0 |       |
| `thinkingmachines`         | Thinking Machines               | `TINKER_API_KEY`                                                                       |     38 |    0 |       |
| `tinfoil`                  | Tinfoil                         | `TINFOIL_API_KEY`                                                                      |      8 |    0 |       |
| `togetherai`               | Together AI                     | `TOGETHER_API_KEY`                                                                     |     32 |    0 |       |
| `tokengo`                  | TokenGo                         | `TOKENGO_API_KEY`                                                                      |     13 |    0 |       |
| `tokenrouter`              | TokenRouter                     | `TOKENROUTER_API_KEY`                                                                  |      1 |    1 |       |
| `trustedrouter`            | TrustedRouter                   | `TRUSTEDROUTER_API_KEY`                                                                |      7 |    0 |       |
| `umans-ai`                 | Umans AI                        | `UMANS_AI_API_KEY`                                                                     |      8 |    0 |       |
| `umans-ai-coding-plan`     | Umans AI Coding Plan            | `UMANS_AI_CODING_PLAN_API_KEY`                                                         |      9 |    9 |       |
| `unorouter`                | UnoRouter                       | `UNOROUTER_API_KEY`                                                                    |     23 |   11 |       |
| `upstage`                  | Upstage                         | `UPSTAGE_API_KEY`                                                                      |      5 |    0 |       |
| `vancine`                  | Vancine                         | `VANCINE_API_KEY`                                                                      |      8 |    0 |       |
| `venice`                   | Venice AI                       | `VENICE_API_KEY`                                                                       |    124 |    0 |       |
| `vercel`                   | Vercel AI Gateway               | `AI_GATEWAY_API_KEY`                                                                   |    421 |    6 |       |
| `vispark`                  | Vispark                         | `VISPARK_LAB_API_KEY`                                                                  |      3 |    0 |       |
| `vivgrid`                  | Vivgrid                         | `VIVGRID_API_KEY`                                                                      |     37 |    0 |       |
| `volcengine`               | Volcengine Ark                  | `ARK_API_KEY`                                                                          |     16 |    0 |       |
| `volcengine-coding-plan`   | Volcengine Ark Coding Plan      | `ARK_CODING_PLAN_API_KEY`                                                              |     10 |   10 |       |
| `vultr`                    | Vultr                           | `VULTR_API_KEY`                                                                        |     15 |    0 |       |
| `wafer.ai`                 | Wafer                           | `WAFER_API_KEY`                                                                        |      5 |    0 |       |
| `wallaby`                  | Wallaby                         | `WALLABY_API_KEY`                                                                      |      1 |    0 |       |
| `wandb`                    | CoreWeave                       | `WANDB_API_KEY`                                                                        |     23 |    0 |       |
| `watsonx`                  | watsonx.ai                      | `WATSONX_AI_APIKEY`, `WATSONX_AI_PROJECT_ID`                                           |      5 |    0 |       |
| `xai`                      | xAI                             | `XAI_API_KEY`                                                                          |     13 |    0 | yes   |
| `xiaomi`                   | Xiaomi                          | `XIAOMI_API_KEY`                                                                       |      9 |    0 |       |
| `xiaomi-token-plan-ams`    | Xiaomi Token Plan (Europe)      | `XIAOMI_API_KEY`                                                                       |      9 |    9 |       |
| `xiaomi-token-plan-cn`     | Xiaomi Token Plan (China)       | `XIAOMI_API_KEY`                                                                       |      9 |    9 |       |
| `xiaomi-token-plan-sgp`    | Xiaomi Token Plan (Singapore)   | `XIAOMI_API_KEY`                                                                       |      9 |    9 |       |
| `xpersona`                 | Xpersona                        | `XPERSONA_API_KEY`                                                                     |     13 |    0 |       |
| `zai`                      | Z.AI                            | `ZHIPU_API_KEY`                                                                        |     18 |    3 |       |
| `zai-coding-plan`          | Z.AI Coding Plan                | `ZHIPU_API_KEY`                                                                        |      7 |    7 |       |
| `zeldoc`                   | Zeldoc                          | `ZELDOC_API_KEY`                                                                       |      1 |    1 |       |
| `zenifra`                  | Zenifra                         | `ZENIFRA_AI_KEY`                                                                       |      1 |    0 |       |
| `zenmux`                   | ZenMux                          | `ZENMUX_API_KEY`                                                                       |    137 |    6 |       |
| `zhipuai`                  | Zhipu AI                        | `ZHIPU_API_KEY`                                                                        |     17 |    3 |       |
| `zhipuai-coding-plan`      | Zhipu AI Coding Plan            | `ZHIPU_API_KEY`                                                                        |      4 |    4 |       |

<!-- providers:end -->
