# Kilo Gateway Provider

[Kilo Gateway](https://kilo.ai/docs/gateway) provides an OpenRouter-compatible API. Agent uses `https://api.kilo.ai/api/openrouter` for inference and checks availability against [the gateway model catalog](https://api.kilo.ai/api/gateway/models).

## Authentication

Authenticate for reliable free and paid inference:

```bash
agent auth login # Select Kilo Gateway
# Alternatively:
export KILO_API_KEY=your_api_key_here
```

Get an API key at [app.kilo.ai](https://app.kilo.ai). Agent can list free models without credentials, but anonymous completion requests may be rejected by the gateway.

## Built-in Free Models

Checked October 12, 2026. These models support reasoning and tool calls with zero input/output token cost.

| Agent model ID                             | Exact gateway ID                         | Context   | Agent output limit |
| ------------------------------------------ | ---------------------------------------- | --------- | ------------------ |
| **`kilo/nemotron-3-super-free` (default)** | `nvidia/nemotron-3-super-120b-a12b:free` | 262,144   | 32,768             |
| `kilo/nemotron-3-ultra-free`               | `nvidia/nemotron-3-ultra-550b-a55b:free` | 1,000,000 | 65,536             |
| `kilo/nemotron-3.5-lightning-free`         | `nvidia/nemotron-3.5-lightning:free`     | 1,000,000 | 65,536             |

```bash
echo "hello" | agent
echo "hello" | agent --model kilo/nemotron-3-super-free
echo "hello" | agent --model kilo/nemotron-3-ultra-free
echo "hello" | agent --model kilo/nemotron-3.5-lightning-free
```

Short names for these built-in aliases also resolve to Kilo. Session titles and compaction use served Kilo entries by default. The gateway's Super output capacity is larger than Agent's conservative 32,768 output cap.

The former GLM-5, GLM 4.5 Air, MiniMax M2.5, Giga Potato, Trinity Large Preview, and DeepSeek R1 free gateway IDs have been withdrawn and their built-ins removed. See [issue #327](https://github.com/link-assistant/agent/issues/327).

## Additional Models

Use a provider model override with an exact gateway ID for models outside the built-in list:

```json
{
  "provider": {
    "kilo": {
      "models": {
        "my-model": {
          "id": "exact/id-from-the-gateway-catalog",
          "limit": { "context": 262144, "output": 32768 }
        }
      }
    }
  }
}
```

Then select `--model kilo/my-model`. Configure pricing and capabilities for that model as appropriate; free catalog listings are subject to change. Operator overrides remain supported.

## API Details

| Property           | Value                                    |
| ------------------ | ---------------------------------------- |
| Inference base URL | `https://api.kilo.ai/api/openrouter`     |
| Model catalog      | `https://api.kilo.ai/api/gateway/models` |
| API format         | OpenRouter-compatible chat completions   |
| Authentication     | Kilo login or `KILO_API_KEY`             |
| Streaming          | Server-Sent Events                       |

The scheduled drift check compares the actual inference IDs, not the shorter Agent aliases. Run it locally with `cd js && npm run check:model-drift`.

## More Information

- [Free Models](../FREE_MODELS.md)
- [Kilo Gateway Documentation](https://kilo.ai/docs/gateway)
- [Kilo GitHub Repository](https://github.com/Kilo-Org/kilo)
