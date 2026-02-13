# Kilo Gateway Provider

[Kilo](https://kilo.ai) is an open-source AI coding agent platform providing unified access to 500+ AI models through the Kilo Gateway. This provider uses an OpenAI-compatible API at `https://api.kilo.ai/api/gateway`.

## Overview

The Kilo Gateway offers:

- **500+ AI Models** - Access to models from Anthropic, OpenAI, Google, xAI, Mistral, MiniMax, and more
- **Free Tier** - Several free models available without API key (using `public` key)
- **BYOK Support** - Bring your own API keys with encrypted-at-rest storage
- **OpenAI-Compatible API** - Drop-in replacement for OpenAI's `/chat/completions` endpoint
- **SSE Streaming** - Full Server-Sent Events streaming support
- **Tool Calling** - Robust function/tool calling capabilities

## Free Models

The following models are available without setting up an API key:

| Model                    | Model ID                      | Provider       | Context Window | Status              |
| ------------------------ | ----------------------------- | -------------- | -------------- | ------------------- |
| **GLM-5 (recommended)**  | `kilo/glm-5-free`             | Z.AI           | 202,752 tokens | Free (limited time) |
| GLM 4.7                  | `kilo/glm-4.7-free`           | Z.AI           | 131,072 tokens | Free                |
| Kimi K2.5                | `kilo/kimi-k2.5-free`         | MoonshotAI     | 131,072 tokens | Free                |
| MiniMax M2.1             | `kilo/minimax-m2.1-free`      | MiniMax        | 131,072 tokens | Free                |
| Giga Potato              | `kilo/giga-potato-free`       | Unknown        | 65,536 tokens  | Free (evaluation)   |
| Trinity Large Preview    | `kilo/trinity-large-preview`  | Arcee AI       | 65,536 tokens  | Free (preview)      |

### GLM-5: Flagship Free Model

GLM-5 is Z.AI's (Zhipu AI) latest flagship model with enhanced reasoning and coding capabilities. Key features:

- **Deep Reasoning** - Excels at "thinking through" complex architectural problems before writing code
- **Fast Inference** - Delivers significantly faster inference speeds than previous GLM versions
- **Bilingual** - Optimized for both Chinese and English
- **Tool Calling** - Full support for function calling and tool use
- **Structured Outputs** - JSON schema validation for structured responses

| Specification     | Value                |
| ----------------- | -------------------- |
| Context Window    | 202,752 tokens       |
| Max Output Tokens | 131,072 tokens       |
| Function Calling  | Yes                  |
| Tool Choice       | Yes                  |
| Reasoning Tokens  | Yes                  |
| Release Date      | February 11, 2026    |

> **Note:** GLM-5 is currently free for a limited time. See the [official announcement](https://blog.kilo.ai/p/glm-5-free-limited-time) for details.

## Configuration

### Using Free Models (No API Key Required)

Free models work out of the box with no configuration:

```bash
# GLM-5 (recommended)
echo "hello" | agent --model kilo/glm-5-free

# GLM 4.7
echo "hello" | agent --model kilo/glm-4.7-free

# Kimi K2.5
echo "hello" | agent --model kilo/kimi-k2.5-free
```

### Using Paid Models

For paid models, set your Kilo API key:

```bash
export KILO_API_KEY=your_api_key_here
```

Get your API key at [app.kilo.ai](https://app.kilo.ai).

## API Details

The Kilo Gateway uses an OpenAI-compatible API:

| Property          | Value                                |
| ----------------- | ------------------------------------ |
| Base URL          | `https://api.kilo.ai/api/gateway`    |
| API Format        | OpenAI-compatible                    |
| Authentication    | Bearer token (`KILO_API_KEY`)        |
| Streaming         | SSE (Server-Sent Events)             |
| Tool Calling      | Supported                            |

### Example API Call (Vercel AI SDK)

```typescript
import { streamText } from "ai"
import { createOpenAI } from "@ai-sdk/openai"

const kilo = createOpenAI({
  baseURL: "https://api.kilo.ai/api/gateway",
  apiKey: process.env.KILO_API_KEY || "public",
})

const result = streamText({
  model: kilo("z-ai/glm-5"),
  prompt: "Write a function to sort an array",
})
```

## Comparison with OpenCode Zen

| Feature          | OpenCode Zen             | Kilo Gateway                  |
| ---------------- | ------------------------ | ----------------------------- |
| Free Models      | 5 (Kimi K2.5, etc.)      | 6+ (GLM-5, GLM 4.7, etc.)     |
| Flagship Free    | Kimi K2.5 Free           | GLM-5 (limited time)          |
| API Format       | OpenAI-compatible        | OpenAI-compatible             |
| Free API Key     | `public`                 | `public`                      |
| Total Models     | 50+                      | 500+                          |
| BYOK Support     | Yes                      | Yes                           |

## More Information

- [Kilo Gateway Documentation](https://kilo.ai/docs/gateway)
- [Free and Budget Models](https://kilo.ai/docs/advanced-usage/free-and-budget-models)
- [GLM-5 Free Announcement](https://blog.kilo.ai/p/glm-5-free-limited-time)
- [Kilo GitHub Repository](https://github.com/Kilo-Org/kilo)
- [Kilo Code VS Code Extension](https://github.com/Kilo-Org/kilocode)
- [Z.AI Developer Documentation](https://docs.z.ai/devpack/overview)
