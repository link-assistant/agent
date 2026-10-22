# Models

This agent supports every provider in the [models.dev](https://models.dev) catalogue (the one [OpenCode](https://github.com/anomalyco/opencode) uses), the subscription logins OpenCode offers, [gpt4free](docs/gpt4free.md), Pollinations and local inference servers. By default, it uses the free Nemotron 3 Super model on [Kilo Gateway](docs/kilo.md). Kilo authentication is recommended for reliable access.

Model lists are loaded at runtime, not hard-coded: models.dev supplies the catalogue and each provider's own `/models` endpoint adds models released since. See [Model discovery](docs/model-discovery.md).

```bash
agent models                    # catalogue models of every configured provider
agent models anthropic          # one provider
agent models --discover         # plus what each provider's API lists right now
agent models --free --discover  # only models that cost nothing
```

## Supported Providers

[Providers](docs/providers.md) lists all of them: env vars, `agent auth login` methods, OpenCode parity and a table of every models.dev provider. The most common ones:

| Provider                | Format                          | Credentials                                                            | Documentation                                                  |
| ----------------------- | ------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| Kilo Gateway            | `kilo/<model-id>`               | `KILO_API_KEY` or Kilo login                                           | [Kilo Gateway Documentation](docs/kilo.md)                     |
| OpenCode Zen            | `opencode/<model-id>`           | `OPENCODE_API_KEY` (paid)                                              | [OpenCode Zen](https://opencode.ai/docs/zen/)                  |
| Anthropic               | `anthropic/<model-id>`          | `ANTHROPIC_API_KEY` or Claude Pro/Max login                            | [Anthropic Docs](https://docs.anthropic.com/)                  |
| Claude OAuth            | `claude-oauth/<model-id>`       | `CLAUDE_CODE_OAUTH_TOKEN`                                              | [Claude OAuth Documentation](docs/claude-oauth.md)             |
| OpenAI                  | `openai/<model-id>`             | `OPENAI_API_KEY` or ChatGPT Plus/Pro login                             | [Providers](docs/providers.md)                                 |
| Google                  | `google/<model-id>`             | `GOOGLE_GENERATIVE_AI_API_KEY` or Google login                         | [Google OAuth](docs/google-oauth.md)                           |
| GitHub Copilot          | `github-copilot/<model-id>`     | GitHub Copilot login                                                   | [Providers](docs/providers.md)                                 |
| Azure OpenAI            | `azure/<deployment>`            | `AZURE_RESOURCE_NAME` + `AZURE_API_KEY`, or Entra ID (Azure CLI) login | [Providers](docs/providers.md#subscription-and-account-logins) |
| Amazon Bedrock          | `amazon-bedrock/<model-id>`     | AWS credentials or `AWS_BEARER_TOKEN_BEDROCK`                          | [Providers](docs/providers.md)                                 |
| Google Vertex AI        | `google-vertex/<model-id>`      | Google Cloud credentials                                               | [Providers](docs/providers.md)                                 |
| xAI                     | `xai/<model-id>`                | `XAI_API_KEY` or SuperGrok login                                       | [Providers](docs/providers.md)                                 |
| Groq                    | `groq/<model-id>`               | `GROQ_API_KEY`                                                         | [Groq Documentation](docs/groq.md)                             |
| OpenRouter              | `openrouter/<provider>/<model>` | `OPENROUTER_API_KEY`                                                   | [OpenRouter Documentation](docs/openrouter.md)                 |
| gpt4free                | `gpt4free/<model-id>`           | none (local Interference API)                                          | [gpt4free](docs/gpt4free.md)                                   |
| Pollinations            | `pollinations/<model-id>`       | none, `POLLINATIONS_API_KEY` optional                                  | [gpt4free](docs/gpt4free.md#pollinations)                      |
| Ollama, vLLM, llama.cpp | `ollama/<model>` etc.           | none (local server)                                                    | [gpt4free](docs/gpt4free.md#local-inference-servers)           |
| Formal AI               | `formal-ai`                     | `FORMAL_AI_API_KEY`                                                    | [Formal AI Documentation](docs/formal-ai.md)                   |

> **Claude OAuth:** The `claude-oauth` provider allows using your Claude Pro/Max subscription. Authenticate with `agent auth claude` or use existing Claude Code CLI credentials with `--use-existing-claude-oauth`.

## Available Models

All models are accessed using the format `<provider>/<model-id>`. Use the `--model` option to specify which model to use:

```bash
echo "hi" | agent --model kilo/nemotron-3-super-free
```

## OpenCode Zen Pricing

Zen's free tier is restricted to OpenCode clients; catalog presence does not guarantee Agent access. Agent does not retry HTTP 403 `FreeTierError`. See [Free Models](FREE_MODELS.md).

Current models and prices per 1M tokens, from models.dev on October 22, 2026. Run `agent models opencode --verbose` for the live list and the older models Zen still serves.

| Model                             | Model ID                               | Input  | Output | Cached Read | Cached Write | Context   |
| --------------------------------- | -------------------------------------- | ------ | ------ | ----------- | ------------ | --------- |
| **Free (OpenCode clients only)**  |
| Nemotron 3.5 Lightning            | `opencode/nemotron-3.5-lightning-free` | Free   | Free   | Free        | -            | 262,144   |
| Big Pickle                        | `opencode/big-pickle`                  | Free   | Free   | Free        | Free         | 200,000   |
| **Paid (sorted by output price)** |
| DeepSeek V4 Flash                 | `opencode/deepseek-v4-flash`           | $0.14  | $0.28  | $0.028      | -            | 1,000,000 |
| Claude Haiku 5.5                  | `opencode/claude-haiku-5-5`            | $0.10  | $0.50  | $0.01       | $0.125       | 1,000,000 |
| GPT-6 Luna                        | `opencode/gpt-6-luna`                  | $0.10  | $0.50  | $0.01       | $0.125       | 1,050,000 |
| MiniMax-M3                        | `opencode/minimax-m3`                  | $0.30  | $1.20  | $0.06       | -            | 512,000   |
| DeepSeek V4 Pro                   | `opencode/deepseek-v4-pro`             | $1.74  | $3.48  | $0.145      | -            | 1,000,000 |
| Kimi K2.7 Code                    | `opencode/kimi-k2.7-code`              | $0.95  | $4.00  | $0.19       | -            | 262,144   |
| GLM-5.3                           | `opencode/glm-5.3`                     | $1.40  | $4.40  | $0.26       | -            | 1,000,000 |
| Grok 4.7                          | `opencode/grok-4.7`                    | $2.00  | $6.00  | $0.50       | -            | 500,000   |
| Qwen3.8 Max                       | `opencode/qwen3.8-max`                 | $2.00  | $6.00  | $0.25       | $2.50        | 262,144   |
| Gemini 3.8 Flash                  | `opencode/gemini-3.8-flash`            | $1.50  | $7.50  | $0.15       | -            | 1,048,576 |
| Claude Sonnet 5.5                 | `opencode/claude-sonnet-5-5`           | $2.00  | $10.00 | $0.20       | $2.50        | 1,000,000 |
| GPT-6.1 Sol                       | `opencode/gpt-6.1-sol`                 | $2.00  | $10.00 | $0.10       | $2.50        | 1,050,000 |
| Gemini 4 Argon                    | `opencode/gemini-4-argon`              | $2.00  | $10.00 | $0.10       | -            | 1,048,576 |
| Kimi K3                           | `opencode/kimi-k3`                     | $3.00  | $15.00 | $0.30       | -            | 1,048,576 |
| Claude Opus 5.5                   | `opencode/claude-opus-5-5`             | $4.00  | $20.00 | $0.20       | $5.00        | 1,000,000 |
| Claude Fable 5.1                  | `opencode/claude-fable-5-1`            | $10.00 | $50.00 | $0.25       | $12.50       | 1,000,000 |
| GPT-6 Astra                       | `opencode/gpt-6-astra`                 | $10.00 | $50.00 | $1.00       | $12.50       | 1,050,000 |

Discontinued free models: `opencode/qwen3.6-plus-free`, `opencode/kimi-k2.5-free`, `opencode/grok-code`, `opencode/minimax-m2.1-free`, `opencode/glm-4.7-free` (see the notes below).

## Default Model

The default model is **Nemotron 3 Super Free** (`kilo/nemotron-3-super-free`), with a 262,144 token context window and a conservative 32,768 token output cap. Authenticate with `agent auth login` (Kilo Gateway) or set `KILO_API_KEY`. Its exact gateway ID is `nvidia/nemotron-3-super-120b-a12b:free`.

For test runs and automation, the default model can be overridden with `LINK_ASSISTANT_AGENT_DEFAULT_MODEL`; an explicit `--model` option still takes precedence. The compaction defaults have matching override variables: `LINK_ASSISTANT_AGENT_DEFAULT_COMPACTION_MODEL`, `LINK_ASSISTANT_AGENT_DEFAULT_COMPACTION_MODELS`, and `LINK_ASSISTANT_AGENT_DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT`.

### Models for Compaction and Session Summaries

Compaction and session summaries use the compaction model (`--compaction-model`, `--compaction-models`), not the model running the turn. The shipped default cascade starts with Kilo Nemotron 3 Super, then Ultra and 3.5 Lightning, followed by `same`; when `--model` points at another provider, entries from other providers are dropped so those secondary calls inherit `--model` instead of calling a provider you may hold no credentials for. A compaction model you name yourself is always used as written. See [issue #307](https://github.com/link-assistant/agent/issues/307).

A model that has no context window to run out of can say so in the provider config, as `"limit": { "context": null }` or `"unlimited": true` on the model. Compaction, context diagnostics, and session summarization are all skipped for such a model — no `--no-summarize-session` needed.

> **Note:** Qwen 3.6 Plus Free (`opencode/qwen3.6-plus-free`) was previously the default free model, but OpenCode Zen ended the free promotion in April 2026. The model now requires an OpenCode Go subscription. See [issue #242](https://github.com/link-assistant/agent/issues/242).

> **Note:** Nemotron 3 Super Free was withdrawn from Zen, along with MiniMax M2.5 Free, Hy3 Preview Free, and Ling 2.6 Flash Free. Use `kilo/nemotron-3-super-free` instead. See [issue #327](https://github.com/link-assistant/agent/issues/327).

> **Note:** Kimi K2.5 Free (`opencode/kimi-k2.5-free`) was previously the default free model, but it was removed from the OpenCode Zen provider in March 2026. See [Case Study #208](docs/case-studies/issue-208/README.md) for details.

> **Note:** Grok Code Fast 1 (`opencode/grok-code`) was previously the default free model, but xAI ended the free tier for this model on OpenCode Zen in January 2026. **The grok-code model is no longer included as a free model in OpenCode Zen subscription.** See [Case Study #133](docs/case-studies/issue-133/README.md) for details.

### Free Models (in order of recommendation)

1. **Nemotron 3 Super** (`kilo/nemotron-3-super-free`) — default (262,144 context).
2. **Nemotron 3 Ultra** (`kilo/nemotron-3-ultra-free`) — 1,000,000 context.
3. **Nemotron 3.5 Lightning** (`kilo/nemotron-3.5-lightning-free`) — 1,000,000 context.

These built-in IDs were checked against the [Kilo catalog](https://api.kilo.ai/api/gateway/models) on October 12, 2026. See [Free Models](FREE_MODELS.md) for withdrawals and the scheduled drift check.

## Usage Examples

### Using the Default Model (Free)

```bash
# Authenticate with agent auth login (Kilo Gateway) or KILO_API_KEY
# Uses kilo/nemotron-3-super-free by default
echo "hello" | agent
```

### Using Other Free Models

```bash
# Built-in free Kilo models (authentication recommended)
echo "hello" | agent --model kilo/nemotron-3-super-free
echo "hello" | agent --model kilo/nemotron-3-ultra-free
echo "hello" | agent --model kilo/nemotron-3.5-lightning-free

# Keyless: gpt4free (local Interference API), Pollinations, local servers
echo "hello" | agent --model gpt4free/auto
echo "hello" | agent --model pollinations/openai
echo "hello" | agent --model ollama/qwen3

# Formal AI local server
echo "hello" | agent --model formal-ai
echo "hello" | agent --model @link-assistant/formal-ai
```

### Using Paid Models

```bash
# Through OpenCode Zen (OPENCODE_API_KEY)
echo "hello" | agent --model opencode/claude-sonnet-5-5
echo "hello" | agent --model opencode/claude-opus-5-5
echo "hello" | agent --model opencode/gpt-6.1-sol
echo "hello" | agent --model opencode/gemini-4-argon
echo "hello" | agent --model opencode/kimi-k2.7-code

# Directly from the provider (API key or `agent auth login`)
echo "hello" | agent --model anthropic/claude-sonnet-5-5
echo "hello" | agent --model openai/gpt-6.1-sol
echo "hello" | agent --model google/gemini-4-argon
echo "hello" | agent --model xai/grok-4.7
echo "hello" | agent --model deepseek/deepseek-v4-pro
```

## More Information

For complete details about OpenCode Zen subscription and pricing, visit the [OpenCode Zen Documentation](https://opencode.ai/docs/zen/).

## Notes

- All prices are per 1 million tokens
- Cache pricing applies when using prompt caching features
- Token context limits vary by model
- Free models have no token costs but may have rate limits

---

## Formal AI Provider

[Formal AI](https://github.com/link-assistant/formal-ai) provides a local symbolic assistant through OpenAI-compatible API routes. Start the local server, export a client key, then use the built-in selector:

```bash
formal-ai serve --agent-mode --host 127.0.0.1 --port 8080
export FORMAL_AI_API_KEY="local-test-token"
agent --model formal-ai --permission-mode plan -p "hi"
```

Agent also accepts `formal-ai/formal-ai`, `@link-assistant/formal-ai`, and `formalai/formal-ai`. For remote hosts or non-default ports, set `FORMAL_AI_BASE_URL` to the full OpenAI-compatible base URL ending in `/api/openai/v1`.

For setup, server checks, and troubleshooting, see the [Formal AI Documentation](docs/formal-ai.md).

---

## Groq Provider

[Groq](https://groq.com/) provides ultra-fast inference for open-source large language models. To use Groq models, set your API key:

```bash
export GROQ_API_KEY=your_api_key_here
```

### Groq Models

| Model                   | Model ID                       | Context Window | Tool Use |
| ----------------------- | ------------------------------ | -------------- | -------- |
| Llama 3.3 70B Versatile | `groq/llama-3.3-70b-versatile` | 131,072 tokens | Yes      |
| Llama 3.1 8B Instant    | `groq/llama-3.1-8b-instant`    | 131,072 tokens | Yes      |
| GPT-OSS 120B            | `groq/openai/gpt-oss-120b`     | 131,072 tokens | Yes      |
| GPT-OSS 20B             | `groq/openai/gpt-oss-20b`      | 131,072 tokens | Yes      |
| Qwen3 32B               | `groq/qwen/qwen3-32b`          | 131,072 tokens | Yes      |
| Compound                | `groq/groq/compound`           | 131,072 tokens | Yes      |
| Compound Mini           | `groq/groq/compound-mini`      | 131,072 tokens | Yes      |

### Groq Usage Examples

```bash
# Using Llama 3.3 70B (recommended)
echo "hello" | agent --model groq/llama-3.3-70b-versatile

# Using faster Llama 3.1 8B
echo "hello" | agent --model groq/llama-3.1-8b-instant

# Using Compound (agentic with server-side tools)
echo "hello" | agent --model groq/groq/compound
```

For more details, see the [Groq Documentation](docs/groq.md).

---

## OpenRouter Provider

[OpenRouter](https://openrouter.ai/) provides unified access to hundreds of AI models from multiple providers including OpenAI, Anthropic, Google, Meta, and more. To use OpenRouter models, set your API key:

```bash
export OPENROUTER_API_KEY=your_api_key_here
```

### OpenRouter Models

| Model             | Model ID                                 | Context Window   | Tool Use |
| ----------------- | ---------------------------------------- | ---------------- | -------- |
| Claude Sonnet 4   | `openrouter/anthropic/claude-sonnet-4`   | 200,000 tokens   | Yes      |
| Claude Sonnet 4.5 | `openrouter/anthropic/claude-sonnet-4-5` | 200,000 tokens   | Yes      |
| GPT-4o            | `openrouter/openai/gpt-4o`               | 128,000 tokens   | Yes      |
| GPT-4o Mini       | `openrouter/openai/gpt-4o-mini`          | 128,000 tokens   | Yes      |
| Llama 3.3 70B     | `openrouter/meta-llama/llama-3.3-70b`    | 131,072 tokens   | Yes      |
| Gemini 2.0 Flash  | `openrouter/google/gemini-2.0-flash`     | 1,000,000 tokens | Yes      |
| DeepSeek V3       | `openrouter/deepseek/deepseek-chat`      | 64,000 tokens    | Yes      |

### OpenRouter Usage Examples

```bash
# Using Claude Sonnet 4 via OpenRouter
echo "hello" | agent --model openrouter/anthropic/claude-sonnet-4

# Using GPT-4o via OpenRouter
echo "hello" | agent --model openrouter/openai/gpt-4o

# Using Llama 3.3 70B via OpenRouter
echo "hello" | agent --model openrouter/meta-llama/llama-3.3-70b

# Using free models (with rate limits)
echo "hello" | agent --model openrouter/meta-llama/llama-3.1-8b:free
```

For more details, see the [OpenRouter Documentation](docs/openrouter.md).

---

## Kilo Gateway Provider

[Kilo](https://kilo.ai) is an open-source AI coding agent platform providing access to 500+ AI models through the Kilo Gateway. The gateway uses an OpenAI-compatible API, making it easy to integrate with existing tools.

### Free Models

Kilo authentication is recommended for reliable inference even when token pricing is zero. Run `agent auth login` and choose Kilo Gateway, or set `KILO_API_KEY`. Anonymous access is subject to gateway restrictions.

| Model                          | Agent model ID                     | Context   | Agent output limit |
| ------------------------------ | ---------------------------------- | --------- | ------------------ |
| **Nemotron 3 Super (default)** | `kilo/nemotron-3-super-free`       | 262,144   | 32,768             |
| Nemotron 3 Ultra               | `kilo/nemotron-3-ultra-free`       | 1,000,000 | 65,536             |
| Nemotron 3.5 Lightning         | `kilo/nemotron-3.5-lightning-free` | 1,000,000 | 65,536             |

```bash
echo "hello" | agent --model kilo/nemotron-3-super-free
echo "hello" | agent --model kilo/nemotron-3-ultra-free
echo "hello" | agent --model kilo/nemotron-3.5-lightning-free
```

The six previous free aliases (GLM-5, GLM 4.5 Air, MiniMax M2.5, Giga Potato, Trinity Large Preview, and DeepSeek R1) were removed because their gateway IDs disappeared. For exact ID mappings, additional model overrides, and paid model authentication, see [Kilo Gateway Documentation](docs/kilo.md).
