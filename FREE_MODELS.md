# Free Models

This document lists all free AI models currently supported by the agent. Free models require no API key and are available for immediate use.

> **Last Updated:** April 2026

## Quick Start

Use any free model with the `--model` flag:

```bash
echo "hello" | agent --model opencode/minimax-m2.5-free
```

## OpenCode Zen Free Models

[OpenCode Zen](https://opencode.ai/docs/zen/) offers curated, tested models. These free models require no authentication:

| Model                 | Model ID                         | Context Window | Description                                       |
| --------------------- | -------------------------------- | -------------- | ------------------------------------------------- |
| MiniMax M2.5 Free     | `opencode/minimax-m2.5-free`     | 204,800        | **Default.** Strong general-purpose performance   |
| Ling 2.6 Flash Free   | `opencode/ling-2.6-flash-free`   | 262,100        | Fast free open-weight model                       |
| Hy3 Preview Free      | `opencode/hy3-preview-free`      | 256,000        | Preview free model with reasoning support         |
| Nemotron 3 Super Free | `opencode/nemotron-3-super-free` | 204,800        | NVIDIA free endpoint with strong reasoning        |
| GPT 5 Nano            | `opencode/gpt-5-nano`            | 400,000        | OpenAI-powered free option and compaction default |
| Big Pickle            | `opencode/big-pickle`            | 200,000        | Stealth model, free during evaluation period      |

Source note: checked on April 23, 2026 against [OpenCode Zen](https://opencode.ai/docs/zen/), `https://opencode.ai/zen/v1/models`, and [models.dev](https://models.dev/api.json). The Zen models endpoint currently also lists `trinity-large-preview-free`, but models.dev marks it deprecated, so it is not recommended here.

### Usage Examples

```bash
# MiniMax M2.5 Free (default)
echo "hello" | agent --model opencode/minimax-m2.5-free

# Ling 2.6 Flash Free
echo "hello" | agent --model opencode/ling-2.6-flash-free

# Hy3 Preview Free
echo "hello" | agent --model opencode/hy3-preview-free

# Nemotron 3 Super Free
echo "hello" | agent --model opencode/nemotron-3-super-free

# GPT 5 Nano
echo "hello" | agent --model opencode/gpt-5-nano

# Big Pickle
echo "hello" | agent --model opencode/big-pickle
```

---

## Kilo Gateway Free Models

[Kilo Gateway](https://kilo.ai/docs/gateway) provides access to 500+ AI models. These free models require no API key:

| Model                 | Model ID                     | Context Window | Description                             |
| --------------------- | ---------------------------- | -------------- | --------------------------------------- |
| GLM-5                 | `kilo/glm-5-free`            | 202,752 tokens | **Recommended.** Z.AI flagship model    |
| GLM 4.5 Air           | `kilo/glm-4.5-air-free`      | 131,072 tokens | Free Z.AI model with agent capabilities |
| MiniMax M2.5          | `kilo/minimax-m2.5-free`     | 204,800 tokens | Strong general-purpose performance      |
| DeepSeek R1           | `kilo/deepseek-r1-free`      | 163,840 tokens | Advanced reasoning model                |
| Giga Potato           | `kilo/giga-potato-free`      | 256,000 tokens | Free evaluation model                   |
| Trinity Large Preview | `kilo/trinity-large-preview` | 131,000 tokens | Arcee AI preview model                  |

### Usage Examples

```bash
# GLM-5 (recommended for Kilo)
echo "hello" | agent --model kilo/glm-5-free

# GLM 4.5 Air
echo "hello" | agent --model kilo/glm-4.5-air-free

# MiniMax M2.5
echo "hello" | agent --model kilo/minimax-m2.5-free

# DeepSeek R1 (reasoning)
echo "hello" | agent --model kilo/deepseek-r1-free

# Giga Potato
echo "hello" | agent --model kilo/giga-potato-free
```

---

## Discontinued Free Models

The following models were previously free but are no longer available:

| Model               | Former Model ID              | Status                                                                                                                                          |
| ------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Qwen 3.6 Plus Free  | `opencode/qwen3.6-plus-free` | Free promotion ended (April 2026) — now requires OpenCode Go subscription. See [issue #242](https://github.com/link-assistant/agent/issues/242) |
| Kimi K2.5 Free      | `opencode/kimi-k2.5-free`    | Removed from OpenCode Zen (March 2026) — see [issue #208](https://github.com/link-assistant/agent/issues/208)                                   |
| Grok Code Fast 1    | `opencode/grok-code`         | Discontinued January 2026                                                                                                                       |
| MiniMax M2.1 Free   | `opencode/minimax-m2.1-free` | Replaced by `opencode/minimax-m2.5-free`                                                                                                        |
| GLM 4.7 Free        | `opencode/glm-4.7-free`      | No longer free on OpenCode Zen                                                                                                                  |
| Kimi K2.5 (Kilo)    | `kilo/kimi-k2.5-free`        | Replaced by other Kilo free models                                                                                                              |
| MiniMax M2.1 (Kilo) | `kilo/minimax-m2.1-free`     | Replaced by `kilo/minimax-m2.5-free`                                                                                                            |

---

## Choosing Between Providers

### Use OpenCode Zen when:

- You want the most tested and reliable free models
- You prefer `minimax-m2.5-free` as the default with a 204,800 token context window
- You need a simple, curated list of models

### Use Kilo Gateway when:

- You want access to GLM-5 (currently free, limited time)
- You need larger context windows (up to 256,000 tokens)
- You want more free model options

### Model Routing

The agent intelligently routes model requests:

- `nemotron-3-super-free` without provider prefix → OpenCode Zen (`opencode/nemotron-3-super-free`)
- `minimax-m2.5-free` without provider prefix → OpenCode Zen (`opencode/minimax-m2.5-free`)
- `ling-2.6-flash-free` without provider prefix → OpenCode Zen (`opencode/ling-2.6-flash-free`)
- `hy3-preview-free` without provider prefix → OpenCode Zen (`opencode/hy3-preview-free`)
- `big-pickle` without provider prefix → OpenCode Zen (`opencode/big-pickle`)
- `kilo/minimax-m2.5-free` explicitly → Kilo Gateway

---

## Privacy Notes

Free models may have different data usage policies:

- **OpenCode Zen free models:** During their free period, collected data may be used to improve the models
- **Kilo Gateway free models:** Check [Kilo's privacy policy](https://kilo.ai/privacy) for details

For production or sensitive use cases, consider using paid models with explicit zero-retention policies.

---

## More Information

- [Full Models Documentation](MODELS.md)
- [OpenCode Zen Documentation](https://opencode.ai/docs/zen/)
- [Kilo Gateway Documentation](docs/kilo.md)
