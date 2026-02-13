# OpenRouter Provider

[OpenRouter](https://openrouter.ai/) is a unified API that provides access to hundreds of AI models from multiple providers including OpenAI, Anthropic, Google, Meta, Mistral, and many more. This guide explains how to use OpenRouter with @link-assistant/agent.

## Quick Start

1. Get your API key from [openrouter.ai/keys](https://openrouter.ai/keys)
2. Set the environment variable:
   ```bash
   export OPENROUTER_API_KEY=your_api_key_here
   ```
3. Run the agent with an OpenRouter model:
   ```bash
   echo "hi" | agent --model openrouter/anthropic/claude-sonnet-4
   ```

> **Important**: Always use the full model format `openrouter/<vendor>/<model>`. See [Common Mistakes](#common-mistakes) section below for details.

## Common Mistakes

### Missing the `openrouter/` prefix

The most common error is omitting the `openrouter/` prefix from the model ID:

```bash
# ❌ Wrong - will cause ProviderModelNotFoundError
agent --model z-ai/glm-4.7
agent --model anthropic/claude-sonnet-4

# ✅ Correct - includes openrouter/ prefix
agent --model openrouter/z-ai/glm-4.7
agent --model openrouter/anthropic/claude-sonnet-4
```

**Why this happens**: The agent parses the model string by the first `/` as the provider. So `z-ai/glm-4.7` is interpreted as provider=`z-ai`, model=`glm-4.7`. Since "z-ai" isn't a registered provider, you get an error.

**The fix**: Always prefix OpenRouter models with `openrouter/`.

## Why OpenRouter?

OpenRouter offers several advantages:

- **One API for all models**: Access OpenAI, Anthropic, Google, Meta, Mistral, and 100+ other models with a single API key
- **Automatic fallbacks**: Configure fallback models if your primary model is unavailable
- **Unified billing**: Pay for all models through one account
- **Competitive pricing**: Often lower prices than direct API access
- **No rate limits**: Higher rate limits compared to some direct providers
- **Model routing**: Automatically route to the cheapest or fastest provider for a model

## Available Models

OpenRouter provides access to hundreds of models. Below are some popular options:

### Claude Models (Anthropic)

| Model             | Model ID                                 | Context Window | Tool Use |
| ----------------- | ---------------------------------------- | -------------- | -------- |
| Claude Sonnet 4   | `openrouter/anthropic/claude-sonnet-4`   | 200,000 tokens | Yes      |
| Claude Sonnet 4.5 | `openrouter/anthropic/claude-sonnet-4-5` | 200,000 tokens | Yes      |
| Claude Opus 4     | `openrouter/anthropic/claude-opus-4`     | 200,000 tokens | Yes      |
| Claude Haiku 3.5  | `openrouter/anthropic/claude-3-5-haiku`  | 200,000 tokens | Yes      |

### GPT Models (OpenAI)

| Model       | Model ID                        | Context Window | Tool Use |
| ----------- | ------------------------------- | -------------- | -------- |
| GPT-4o      | `openrouter/openai/gpt-4o`      | 128,000 tokens | Yes      |
| GPT-4o Mini | `openrouter/openai/gpt-4o-mini` | 128,000 tokens | Yes      |
| GPT-4 Turbo | `openrouter/openai/gpt-4-turbo` | 128,000 tokens | Yes      |
| o1          | `openrouter/openai/o1`          | 200,000 tokens | Yes      |
| o1-mini     | `openrouter/openai/o1-mini`     | 128,000 tokens | Yes      |

### Gemini Models (Google)

| Model            | Model ID                             | Context Window   | Tool Use |
| ---------------- | ------------------------------------ | ---------------- | -------- |
| Gemini 2.0 Flash | `openrouter/google/gemini-2.0-flash` | 1,000,000 tokens | Yes      |
| Gemini 1.5 Pro   | `openrouter/google/gemini-pro-1.5`   | 2,000,000 tokens | Yes      |
| Gemini 1.5 Flash | `openrouter/google/gemini-flash-1.5` | 1,000,000 tokens | Yes      |

### Llama Models (Meta)

| Model          | Model ID                               | Context Window | Tool Use |
| -------------- | -------------------------------------- | -------------- | -------- |
| Llama 3.3 70B  | `openrouter/meta-llama/llama-3.3-70b`  | 131,072 tokens | Yes      |
| Llama 3.1 405B | `openrouter/meta-llama/llama-3.1-405b` | 131,072 tokens | Yes      |
| Llama 3.1 70B  | `openrouter/meta-llama/llama-3.1-70b`  | 131,072 tokens | Yes      |
| Llama 3.1 8B   | `openrouter/meta-llama/llama-3.1-8b`   | 131,072 tokens | Yes      |

### Mistral Models

| Model          | Model ID                              | Context Window | Tool Use |
| -------------- | ------------------------------------- | -------------- | -------- |
| Mistral Large  | `openrouter/mistralai/mistral-large`  | 128,000 tokens | Yes      |
| Mistral Medium | `openrouter/mistralai/mistral-medium` | 32,000 tokens  | Yes      |
| Mixtral 8x22B  | `openrouter/mistralai/mixtral-8x22b`  | 65,536 tokens  | Yes      |
| Codestral      | `openrouter/mistralai/codestral`      | 32,000 tokens  | Yes      |

### DeepSeek Models

| Model       | Model ID                            | Context Window | Tool Use |
| ----------- | ----------------------------------- | -------------- | -------- |
| DeepSeek V3 | `openrouter/deepseek/deepseek-chat` | 64,000 tokens  | Yes      |
| DeepSeek R1 | `openrouter/deepseek/deepseek-r1`   | 64,000 tokens  | Yes      |

### Free Models

OpenRouter offers some models for free (with rate limits):

| Model               | Model ID                                     | Context Window |
| ------------------- | -------------------------------------------- | -------------- |
| Llama 3.1 8B (Free) | `openrouter/meta-llama/llama-3.1-8b:free`    | 131,072 tokens |
| Gemma 2 9B (Free)   | `openrouter/google/gemma-2-9b-it:free`       | 8,192 tokens   |
| Phi-3 Mini (Free)   | `openrouter/microsoft/phi-3-mini-128k:free`  | 128,000 tokens |
| Qwen 2.5 72B (Free) | `openrouter/qwen/qwen-2.5-72b-instruct:free` | 32,768 tokens  |

> **Note**: Free models have rate limits. Check [openrouter.ai/models](https://openrouter.ai/models) for current availability.

## Usage Examples

### Basic Usage

```bash
# Using Claude Sonnet 4 via OpenRouter
echo "What is the capital of France?" | agent --model openrouter/anthropic/claude-sonnet-4

# Using GPT-4o via OpenRouter
echo "Write a haiku about programming" | agent --model openrouter/openai/gpt-4o

# Using a free model
echo "Hello!" | agent --model openrouter/meta-llama/llama-3.1-8b:free
```

### Tool Use Examples

OpenRouter models support tool use / function calling, which allows the agent to execute tools like bash commands, file operations, and web searches:

```bash
# Tool use with file operations
echo "List the files in the current directory" | agent --model openrouter/anthropic/claude-sonnet-4

# Tool use with bash commands
echo '{"message":"run ls -la","tools":[{"name":"bash","params":{"command":"ls -la"}}]}' | agent --model openrouter/openai/gpt-4o
```

### JSON Input/Output

```bash
# JSON input
echo '{"message":"hello world"}' | agent --model openrouter/anthropic/claude-sonnet-4

# With Claude-compatible output format
echo "hi" | agent --model openrouter/anthropic/claude-sonnet-4 --json-standard claude
```

## Tool Use Support

Most models on OpenRouter support tool use (function calling). The agent's 13 tools work with OpenRouter models:

- **File Operations**: `read`, `write`, `edit`, `list`
- **Search Tools**: `glob`, `grep`, `websearch`, `codesearch`
- **Execution Tools**: `bash`, `batch`, `task`
- **Utility Tools**: `todo`, `webfetch`

### Recommended Models for Tool Use

For best tool use performance, we recommend:

1. **Claude Sonnet 4 / 4.5** - Excellent tool use capabilities
2. **GPT-4o** - Strong function calling support
3. **Gemini 2.0 Flash** - Fast with good tool support
4. **Llama 3.3 70B** - Best open-source option for tools

## Authentication

### Using Environment Variable (Recommended)

```bash
export OPENROUTER_API_KEY=your_api_key_here
echo "hello" | agent --model openrouter/anthropic/claude-sonnet-4
```

### Using Auth Command

```bash
# Interactive login
agent auth login
# Select: OpenRouter
# Enter your API key when prompted

# Verify credentials
agent auth list
```

## Pricing

OpenRouter offers pay-as-you-go pricing with no minimum commitment. Prices vary by model and are often competitive with or lower than direct API access.

Key benefits:

- **Pay per token**: Only pay for what you use
- **No subscriptions required**: Unlike Claude Pro/Max or ChatGPT Plus
- **Transparent pricing**: See prices for all models at [openrouter.ai/models](https://openrouter.ai/models)
- **Free credits**: New accounts often receive free credits to get started

Check [openrouter.ai/models](https://openrouter.ai/models) for current pricing on all models.

## Environment Variables

| Variable             | Description                                                                   |
| -------------------- | ----------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY` | Your OpenRouter API key from [openrouter.ai/keys](https://openrouter.ai/keys) |

## Configuration

You can also configure OpenRouter in your OpenCode configuration file (`~/.config/opencode/opencode.json`):

```json
{
  "provider": {
    "openrouter": {
      "options": {
        "apiKey": "your_api_key_here"
      }
    }
  }
}
```

## Model ID Format

OpenRouter model IDs follow this format:

```
openrouter/<provider>/<model-name>
```

Examples:

- `openrouter/anthropic/claude-sonnet-4`
- `openrouter/openai/gpt-4o`
- `openrouter/meta-llama/llama-3.3-70b`
- `openrouter/google/gemini-2.0-flash`

For free models, append `:free`:

- `openrouter/meta-llama/llama-3.1-8b:free`

## Advanced Features

### Caching Support

OpenRouter supports prompt caching for compatible models (like Claude). The agent automatically enables caching when available, which can reduce costs for repeated prompts.

### Custom Headers

The agent automatically includes required headers for OpenRouter:

- `HTTP-Referer`: Application identifier
- `X-Title`: Application name

These headers help OpenRouter track usage and may be required for some features.

## Troubleshooting

### "Invalid API key"

- Verify your API key at [openrouter.ai/keys](https://openrouter.ai/keys)
- Ensure `OPENROUTER_API_KEY` is set correctly
- Try `agent auth logout` and `agent auth login` to re-authenticate

### "ProviderModelNotFoundError" or "Model not found"

**Most common cause**: Missing the `openrouter/` prefix.

```bash
# Wrong - will give ProviderModelNotFoundError
agent --model z-ai/glm-4.7
agent --model anthropic/claude-sonnet-4

# Correct - includes openrouter/ prefix
agent --model openrouter/z-ai/glm-4.7
agent --model openrouter/anthropic/claude-sonnet-4
```

**Note**: When you omit the `openrouter/` prefix, the agent interprets the first part of the model ID as a provider name. For example, `z-ai/glm-4.7` is parsed as provider=`z-ai` and model=`glm-4.7`, but there's no provider called "z-ai" - the provider is "openrouter".

Other solutions:

- Verify the model is available at [openrouter.ai/models](https://openrouter.ai/models)
- Some models may require additional verification or payment

### "Rate limit exceeded"

- Free models have strict rate limits
- Consider upgrading to a paid model or adding credits
- Wait a few minutes and try again

### "Insufficient credits"

- Add credits at [openrouter.ai/credits](https://openrouter.ai/credits)
- Check your usage at [openrouter.ai/activity](https://openrouter.ai/activity)

## More Information

- [OpenRouter Documentation](https://openrouter.ai/docs)
- [Available Models](https://openrouter.ai/models)
- [API Reference](https://openrouter.ai/docs/api-reference)
- [Pricing](https://openrouter.ai/docs/pricing)
- [Rate Limits](https://openrouter.ai/docs/rate-limits)
