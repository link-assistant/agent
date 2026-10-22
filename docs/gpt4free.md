# gpt4free, Pollinations and local servers

[gpt4free](https://github.com/xtekky/gpt4free) (g4f) routes OpenAI-style
requests to many upstream providers, most of them free. models.dev does not
list it, so the agent adds it, its hosted gateway, Pollinations, the other
OpenAI-compatible services from gpt4free's provider list, and common local
inference servers (#334).

All of them use `@ai-sdk/openai-compatible` and the model listing described
in [model-discovery.md](model-discovery.md).

## Keyless providers are explicit-only

Providers that work without a key (gpt4free, g4f.space, Pollinations and
local servers) are only enabled when you name them with
`--model provider/model`, `agent models provider` or in the config. They
never become the default and never answer a short model name such as
`--model auto`. This keeps a stray local server or a free router from
quietly taking over a run.

Routers and local servers are **passthrough** providers: a model ID that is
not listed anywhere is sent unchanged, because gpt4free, Ollama and others
accept models they do not advertise.

## gpt4free Interference API (local)

Start the gpt4free API. Its docs use port 1337 for the Interference API:

```bash
# Docker (slim image)
docker run -p 1337:8080 -p 8080:8080 hlohaus789/g4f:latest-slim

# or Python
pip install -U "g4f[all]"
python -m g4f --port 1337
```

Then:

```bash
echo "hello" | agent --model gpt4free/auto
agent models gpt4free --discover          # what this server offers now
echo "hello" | agent --model gpt4free/gpt-4o-mini
```

| Setting                              | Default                    | Purpose                                        |
| ------------------------------------ | -------------------------- | ---------------------------------------------- |
| `G4F_BASE_URL` / `GPT4FREE_BASE_URL` | `http://localhost:1337/v1` | Where the Interference API runs                |
| `G4F_API_KEY`                        | none                       | Sent as a bearer token if the server needs one |
| `G4F_PROVIDER`                       | none                       | Pin one gpt4free provider (see below)          |

`auto` lets gpt4free pick and rotate upstream providers. `g4f/...` and
`gpt-4-free/...` are accepted as spellings of `gpt4free/...`.

### Pinning a gpt4free provider

gpt4free serves each of its providers under `/api/{provider}`. Setting
`G4F_PROVIDER` makes the agent use that route for chat and model listings:

```bash
G4F_PROVIDER=PollinationsAI agent --model gpt4free/auto
# requests go to http://localhost:1337/api/PollinationsAI/chat/completions
```

## g4f.space (hosted gpt4free)

The public gpt4free gateway, no local install:

```bash
echo "hello" | agent --model g4f-space/auto
```

| Setting              | Default                |
| -------------------- | ---------------------- |
| `G4F_SPACE_BASE_URL` | `https://g4f.space/v1` |
| `G4F_SPACE_API_KEY`  | none (optional)        |

`G4F_PROVIDER` applies here too. Public servers come and go and may limit
requests; use the local API for anything important.

## Pollinations

[Pollinations](https://pollinations.ai) offers free text models
anonymously, with higher limits for a key:

```bash
echo "hello" | agent --model pollinations/openai
agent models pollinations --discover
```

| Setting                 | Default                          |
| ----------------------- | -------------------------------- |
| `POLLINATIONS_BASE_URL` | `https://gen.pollinations.ai/v1` |
| `POLLINATIONS_API_KEY`  | none (optional)                  |

Built-in aliases: `openai`, `openai-fast`, `deepseek`, `kimi`, `minimax`,
`nemotron`. The live listing adds the rest; aliases a model announces are
accepted as well.

## Other services from gpt4free's provider list

OpenAI-compatible services that need a key. They are enabled when the key is
set:

| Provider ID        | Base URL                              | Key env var                               |
| ------------------ | ------------------------------------- | ----------------------------------------- |
| `airforce`         | `https://api.airforce/v1`             | `AIRFORCE_API_KEY`                        |
| `aibadgr`          | `https://aibadgr.com/api/v1`          | `AIBADGR_API_KEY`                         |
| `api-route`        | `https://global.api-route.com/v1`     | `APIROUTE_API_KEY` or `API_ROUTE_API_KEY` |
| `cheaperinference` | `https://api.cheaperinference.com/v1` | `CHEAPERINFERENCE_API_KEY`                |
| `theb`             | `https://api.theb.ai/v1`              | `THEB_API_KEY`                            |

Most other gpt4free providers are services models.dev already lists, such as
OpenRouter, Groq, DeepInfra, Together, Cerebras, Mistral, Nvidia, Hugging
Face, Venice, AIHubMix and Ollama Cloud. Use them through their models.dev
IDs; see [providers.md](providers.md). The rest scrape web apps or need a
browser session, and they are only reachable through the gpt4free API above.

## Local inference servers

| Provider ID              | Default base URL            | Override                         | Key (optional)      |
| ------------------------ | --------------------------- | -------------------------------- | ------------------- |
| `ollama`                 | `http://127.0.0.1:11434/v1` | `OLLAMA_BASE_URL`, `OLLAMA_HOST` | none                |
| `vllm`                   | `http://127.0.0.1:8000/v1`  | `VLLM_BASE_URL`                  | `VLLM_API_KEY`      |
| `llamacpp` (`llama.cpp`) | `http://127.0.0.1:8080/v1`  | `LLAMACPP_BASE_URL`              | `LLAMACPP_API_KEY`  |
| `lmstudio`               | models.dev entry            | `LMSTUDIO_BASE_URL`              | none                |
| `omniroute`              | `http://localhost:20128/v1` | `OMNIROUTE_BASE_URL`             | `OMNIROUTE_API_KEY` |

```bash
ollama pull qwen3
echo "hello" | agent --model ollama/qwen3
OLLAMA_HOST=gpu-box:11434 agent models ollama --discover
```

`OLLAMA_HOST` may point at the server root; `/v1` is appended.

## Configuration file

Any of these can also be set in the config instead of the environment:

```json
{
  "provider": {
    "gpt4free": {
      "options": { "baseURL": "http://g4f.lan:1337/v1" }
    }
  }
}
```

Implementation: `js/src/provider/extra-providers.ts`. Tests:
`js/tests/provider-parity.ts`.
