# Free Models

This document lists all free AI models currently supported by the agent. Free models require no API key and are available for immediate use.

> **Last Updated:** February 2026

## Quick Start

Use any free model with the `--model` flag:

```bash
echo "hello" | agent --model opencode/kimi-k2.5-free
```

## OpenCode Zen Free Models

[OpenCode Zen](https://opencode.ai/docs/zen/) offers curated, tested models. These free models require no authentication:

| Model             | Model ID                      | Description                                      |
| ----------------- | ----------------------------- | ------------------------------------------------ |
| Kimi K2.5 Free    | `opencode/kimi-k2.5-free`     | **Recommended.** Best free model for coding tasks |
| MiniMax M2.5 Free | `opencode/minimax-m2.5-free`  | Strong general-purpose performance               |
| GPT 5 Nano        | `opencode/gpt-5-nano`         | Reliable OpenAI-powered free option              |
| Big Pickle        | `opencode/big-pickle`         | Stealth model, free during evaluation period     |

### Usage Examples

```bash
# Kimi K2.5 Free (recommended)
echo "hello" | agent --model opencode/kimi-k2.5-free

# MiniMax M2.5 Free
echo "hello" | agent --model opencode/minimax-m2.5-free

# GPT 5 Nano
echo "hello" | agent --model opencode/gpt-5-nano

# Big Pickle
echo "hello" | agent --model opencode/big-pickle
```

---

## Kilo Gateway Free Models

[Kilo Gateway](https://kilo.ai/docs/gateway) provides access to 500+ AI models. These free models require no API key:

| Model                 | Model ID                       | Context Window | Description                               |
| --------------------- | ------------------------------ | -------------- | ----------------------------------------- |
| GLM-5                 | `kilo/glm-5-free`              | 202,752 tokens | **Recommended.** Z.AI flagship model      |
| GLM 4.5 Air           | `kilo/glm-4.5-air-free`        | 131,072 tokens | Free Z.AI model with agent capabilities   |
| MiniMax M2.5          | `kilo/minimax-m2.5-free`       | 204,800 tokens | Strong general-purpose performance        |
| DeepSeek R1           | `kilo/deepseek-r1-free`        | 163,840 tokens | Advanced reasoning model                  |
| Giga Potato           | `kilo/giga-potato-free`        | 256,000 tokens | Free evaluation model                     |
| Trinity Large Preview | `kilo/trinity-large-preview`   | 131,000 tokens | Arcee AI preview model                    |

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

| Model              | Former Model ID               | Status                                   |
| ------------------ | ----------------------------- | ---------------------------------------- |
| Grok Code Fast 1   | `opencode/grok-code`          | Discontinued January 2026                |
| MiniMax M2.1 Free  | `opencode/minimax-m2.1-free`  | Replaced by `opencode/minimax-m2.5-free` |
| GLM 4.7 Free       | `opencode/glm-4.7-free`       | No longer free on OpenCode Zen           |
| Kimi K2.5 (Kilo)   | `kilo/kimi-k2.5-free`         | Replaced by other Kilo free models       |
| MiniMax M2.1 (Kilo)| `kilo/minimax-m2.1-free`      | Replaced by `kilo/minimax-m2.5-free`     |

---

## Choosing Between Providers

### Use OpenCode Zen when:
- You want the most tested and reliable free models
- You prefer `kimi-k2.5-free` as the recommended choice
- You need a simple, curated list of models

### Use Kilo Gateway when:
- You want access to GLM-5 (currently free, limited time)
- You need larger context windows (up to 256,000 tokens)
- You want more free model options

### Model Routing

The agent intelligently routes model requests:

- `minimax-m2.5-free` without provider prefix → OpenCode Zen (`opencode/minimax-m2.5-free`)
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
