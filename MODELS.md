# Models

This agent supports multiple model providers. By default, it uses models from the [OpenCode Zen](https://opencode.ai/docs/zen/) subscription service. Additionally, you can use models directly from providers like [Groq](https://groq.com/) by setting the appropriate API key.

## Supported Providers

| Provider | Format | API Key Env Variable | Documentation |
|----------|--------|---------------------|---------------|
| OpenCode Zen | `opencode/<model-id>` | N/A (public for free models) | [OpenCode Zen](https://opencode.ai/docs/zen/) |
| Anthropic | `anthropic/<model-id>` | `ANTHROPIC_API_KEY` | [Anthropic Docs](https://docs.anthropic.com/) |
| Claude OAuth | `claude-oauth/<model-id>` | `CLAUDE_CODE_OAUTH_TOKEN` | [Claude OAuth Documentation](docs/claude-oauth.md) |
| Groq | `groq/<model-id>` | `GROQ_API_KEY` | [Groq Documentation](docs/groq.md) |

> **Claude OAuth:** The `claude-oauth` provider allows using your Claude Pro/Max subscription. Authenticate with `agent auth claude` or use existing Claude Code CLI credentials with `--use-existing-claude-oauth`.

## Available Models

All models are accessed using the format `<provider>/<model-id>`. Use the `--model` option to specify which model to use:

```bash
echo "hi" | agent --model opencode/grok-code
```

## OpenCode Zen Pricing

Below are the prices per 1M tokens for OpenCode Zen models. Models are sorted by output price (lowest first) for best pricing visibility.

| Model | Model ID | Input | Output | Cached Read | Cached Write |
|-------|----------|-------|--------|-------------|--------------|
| **Free Models (Output: $0.00)** |
| Grok Code Fast 1 | `opencode/grok-code` | Free | Free | Free | - |
| GPT 5 Nano | `opencode/gpt-5-nano` | Free | Free | Free | - |
| Big Pickle | `opencode/big-pickle` | Free | Free | Free | - |
| **Paid Models (sorted by output price)** |
| Qwen3 Coder 480B | `opencode/qwen3-coder-480b` | $0.45 | $1.50 | - | - |
| GLM 4.6 | `opencode/glm-4-6` | $0.60 | $2.20 | $0.10 | - |
| Kimi K2 | `opencode/kimi-k2` | $0.60 | $2.50 | $0.36 | - |
| Claude Haiku 3.5 | `opencode/claude-haiku-3-5` | $0.80 | $4.00 | $0.08 | $1.00 |
| Claude Haiku 4.5 | `opencode/haiku` | $1.00 | $5.00 | $0.10 | $1.25 |
| GPT 5.1 | `opencode/gpt-5-1` | $1.25 | $10.00 | $0.125 | - |
| GPT 5.1 Codex | `opencode/gpt-5-1-codex` | $1.25 | $10.00 | $0.125 | - |
| GPT 5 | `opencode/gpt-5` | $1.25 | $10.00 | $0.125 | - |
| GPT 5 Codex | `opencode/gpt-5-codex` | $1.25 | $10.00 | $0.125 | - |
| Gemini 3 Pro (≤ 200K tokens) | `opencode/gemini-3-pro` | $2.00 | $12.00 | $0.20 | - |
| Claude Sonnet 4.5 (≤ 200K tokens) | `opencode/sonnet` | $3.00 | $15.00 | $0.30 | $3.75 |
| Claude Sonnet 4 (≤ 200K tokens) | `opencode/claude-sonnet-4` | $3.00 | $15.00 | $0.30 | $3.75 |
| Gemini 3 Pro (> 200K tokens) | `opencode/gemini-3-pro` | $4.00 | $18.00 | $0.40 | - |
| Claude Sonnet 4.5 (> 200K tokens) | `opencode/sonnet` | $6.00 | $22.50 | $0.60 | $7.50 |
| Claude Sonnet 4 (> 200K tokens) | `opencode/claude-sonnet-4` | $6.00 | $22.50 | $0.60 | $7.50 |
| Claude Opus 4.1 | `opencode/opus` | $15.00 | $75.00 | $1.50 | $18.75 |

## Default Model

The default model is **Grok Code Fast 1** (`opencode/grok-code`), which is completely free. This model provides excellent performance for coding tasks with no cost.

## Usage Examples

### Using the Default Model (Free)

```bash
# Uses opencode/grok-code by default
echo "hello" | agent
```

### Using Other Free Models

```bash
# Big Pickle (free)
echo "hello" | agent --model opencode/big-pickle

# GPT 5 Nano (free)
echo "hello" | agent --model opencode/gpt-5-nano
```

### Using Paid Models

```bash
# Claude Sonnet 4.5 (best quality)
echo "hello" | agent --model opencode/sonnet

# Claude Haiku 4.5 (fast and affordable)
echo "hello" | agent --model opencode/haiku

# Claude Opus 4.1 (most capable)
echo "hello" | agent --model opencode/opus

# Gemini 3 Pro
echo "hello" | agent --model opencode/gemini-3-pro

# GPT 5.1
echo "hello" | agent --model opencode/gpt-5-1

# Qwen3 Coder (specialized for coding)
echo "hello" | agent --model opencode/qwen3-coder-480b
```

## More Information

For complete details about OpenCode Zen subscription and pricing, visit the [OpenCode Zen Documentation](https://opencode.ai/docs/zen/).

## Notes

- All prices are per 1 million tokens
- Cache pricing applies when using prompt caching features
- Token context limits vary by model
- Free models have no token costs but may have rate limits

---

## Groq Provider

[Groq](https://groq.com/) provides ultra-fast inference for open-source large language models. To use Groq models, set your API key:

```bash
export GROQ_API_KEY=your_api_key_here
```

### Groq Models

| Model | Model ID | Context Window | Tool Use |
|-------|----------|----------------|----------|
| Llama 3.3 70B Versatile | `groq/llama-3.3-70b-versatile` | 131,072 tokens | Yes |
| Llama 3.1 8B Instant | `groq/llama-3.1-8b-instant` | 131,072 tokens | Yes |
| GPT-OSS 120B | `groq/openai/gpt-oss-120b` | 131,072 tokens | Yes |
| GPT-OSS 20B | `groq/openai/gpt-oss-20b` | 131,072 tokens | Yes |
| Qwen3 32B | `groq/qwen/qwen3-32b` | 131,072 tokens | Yes |
| Compound | `groq/groq/compound` | 131,072 tokens | Yes |
| Compound Mini | `groq/groq/compound-mini` | 131,072 tokens | Yes |

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
