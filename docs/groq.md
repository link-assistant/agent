# Groq Provider

[Groq](https://groq.com/) provides ultra-fast inference for open-source large language models. This guide explains how to use Groq with @link-assistant/agent.

## Quick Start

1. Get your API key from [console.groq.com](https://console.groq.com/keys)
2. Set the environment variable:
   ```bash
   export GROQ_API_KEY=your_api_key_here
   ```
3. Run the agent with a Groq model:
   ```bash
   echo "hi" | agent --model groq/llama-3.3-70b-versatile
   ```

## Available Models

Groq hosts a variety of models optimized for fast inference. Below are the available models with their capabilities:

### Production Models

| Model                   | Model ID                                             | Context Window | Tool Use |
| ----------------------- | ---------------------------------------------------- | -------------- | -------- |
| Llama 3.3 70B Versatile | `groq/llama-3.3-70b-versatile`                       | 131,072 tokens | Yes      |
| Llama 3.1 8B Instant    | `groq/llama-3.1-8b-instant`                          | 131,072 tokens | Yes      |
| Llama Guard 4 12B       | `groq/meta-llama/llama-guard-4-12b`                  | 131,072 tokens | Yes      |
| GPT-OSS 120B            | `groq/openai/gpt-oss-120b`                           | 131,072 tokens | Yes      |
| GPT-OSS 20B             | `groq/openai/gpt-oss-20b`                            | 131,072 tokens | Yes      |
| Qwen3 32B               | `groq/qwen/qwen3-32b`                                | 131,072 tokens | Yes      |
| Kimi K2 Instruct        | `groq/moonshotai/kimi-k2-instruct-0905`              | 131,072 tokens | Yes      |
| Llama 4 Scout           | `groq/meta-llama/llama-4-scout-17b-16e-instruct`     | 131,072 tokens | Yes      |
| Llama 4 Maverick        | `groq/meta-llama/llama-4-maverick-17b-128e-instruct` | 131,072 tokens | Yes      |

### Compound Systems (Agentic)

| Model         | Model ID                  | Context Window | Tool Use          |
| ------------- | ------------------------- | -------------- | ----------------- |
| Compound      | `groq/groq/compound`      | 131,072 tokens | Yes (server-side) |
| Compound Mini | `groq/groq/compound-mini` | 131,072 tokens | Yes (server-side) |

### Speech-to-Text Models

| Model                  | Model ID                      | Description              |
| ---------------------- | ----------------------------- | ------------------------ |
| Whisper Large V3       | `groq/whisper-large-v3`       | Speech-to-text           |
| Whisper Large V3 Turbo | `groq/whisper-large-v3-turbo` | Optimized speech-to-text |

## Usage Examples

### Basic Usage

```bash
# Using Llama 3.3 70B (recommended for general use)
echo "What is the capital of France?" | agent --model groq/llama-3.3-70b-versatile

# Using Llama 3.1 8B (faster, lighter)
echo "Write a haiku about programming" | agent --model groq/llama-3.1-8b-instant
```

### Tool Use Examples

Groq models support tool use / function calling, which allows the agent to execute tools like bash commands, file operations, and web searches:

```bash
# Tool use with file operations
echo "List the files in the current directory" | agent --model groq/llama-3.3-70b-versatile

# Tool use with bash commands
echo '{"message":"run ls -la","tools":[{"name":"bash","params":{"command":"ls -la"}}]}' | agent --model groq/llama-3.3-70b-versatile
```

### JSON Input/Output

```bash
# JSON input
echo '{"message":"hello world"}' | agent --model groq/llama-3.3-70b-versatile

# With Claude-compatible output format
echo "hi" | agent --model groq/llama-3.3-70b-versatile --json-standard claude
```

## Tool Use Support

All production text models on Groq support tool use (function calling). The agent's 13 tools work with Groq models:

- **File Operations**: `read`, `write`, `edit`, `list`
- **Search Tools**: `glob`, `grep`, `websearch`, `codesearch`
- **Execution Tools**: `bash`, `batch`, `task`
- **Utility Tools**: `todo`, `webfetch`

### Parallel Tool Calling

The following models support parallel tool calling:

- Llama 3.3 70B Versatile
- Llama 3.1 8B Instant
- Qwen3 32B
- Llama 4 Scout/Maverick
- Kimi K2 Instruct

## Pricing

Groq offers competitive pricing for inference. Check [console.groq.com](https://console.groq.com/docs/pricing) for current pricing information.

Key benefits:

- Ultra-fast inference speeds
- Competitive token pricing
- Large context windows (131K tokens)
- No rate limiting on paid plans

## Environment Variables

| Variable       | Description                                                                   |
| -------------- | ----------------------------------------------------------------------------- |
| `GROQ_API_KEY` | Your Groq API key from [console.groq.com/keys](https://console.groq.com/keys) |

## Configuration

You can also configure Groq in your OpenCode configuration file (`~/.config/opencode/opencode.json`):

```json
{
  "provider": {
    "groq": {
      "options": {
        "apiKey": "your_api_key_here"
      }
    }
  }
}
```

## More Information

- [Groq Documentation](https://console.groq.com/docs/overview)
- [Groq Models Documentation](https://console.groq.com/docs/models)
- [Tool Use Documentation](https://console.groq.com/docs/tool-use)
- [API Reference](https://console.groq.com/docs/api-reference)
