# Free Models

This document lists selected free models in provider catalogues. Catalogue availability does not guarantee that a provider accepts requests from a standalone agent.

> **OpenCode catalogue checked:** October 12, 2026. The Kilo entries below were last checked in April 2026; see [issue #327](https://github.com/link-assistant/agent/issues/327) for gateway changes.

## Quick Start

Use any free model with the `--model` flag:

```bash
echo "hello" | agent --model opencode/big-pickle
```

## OpenCode Zen Free Models

[OpenCode Zen](https://opencode.ai/docs/zen/) offers curated models. The following IDs appear in its [live catalogue](https://opencode.ai/zen/v1/models) and have non-deprecated [models.dev metadata](https://models.dev/api.json):

| Model                       | Model ID                               | Context Window | Description                       |
| --------------------------- | -------------------------------------- | -------------- | --------------------------------- |
| Big Pickle                  | `opencode/big-pickle`                  | 200,000        | **Default.** Free catalogue entry |
| Ling 3.1 Flash Free         | `opencode/ling-3.1-flash-free`         | 262,144        | Ling Flash free endpoint          |
| Nemotron 3.5 Lightning Free | `opencode/nemotron-3.5-lightning-free` | 262,144        | NVIDIA reasoning model            |

Zen's free tier has been reported to reject standalone Agent requests with HTTP 403 `FreeTierError` ("OpenCode's free tier can only be used from within OpenCode"). See [issue #327](https://github.com/link-assistant/agent/issues/327#issuecomment-6040047705). Changing the default fixes the withdrawn model ID; it does not remove that provider restriction. Use `--model` or `LINK_ASSISTANT_AGENT_DEFAULT_MODEL` to select a provider you can access.

`gpt-5-nano` remains in the compaction cascade for its 400,000 token context, but models.dev now lists it as paid. It requires Zen credentials when not offered for free; unavailable entries are skipped before the final `same` fallback.

### Usage Examples

```bash
# Big Pickle (default; subject to Zen access restrictions)
echo "hello" | agent --model opencode/big-pickle

# Other currently listed Zen free models
echo "hello" | agent --model opencode/ling-3.1-flash-free
echo "hello" | agent --model opencode/nemotron-3.5-lightning-free
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

| Model                 | Former Model ID                  | Status                                                                                                                                          |
| --------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| MiniMax M2.5 Free     | `opencode/minimax-m2.5-free`     | Deprecated on models.dev and absent from Zen (October 2026). See [issue #328](https://github.com/link-assistant/agent/issues/328).              |
| Nemotron 3 Super Free | `opencode/nemotron-3-super-free` | Deprecated on models.dev and absent from Zen (October 2026). See [issue #327](https://github.com/link-assistant/agent/issues/327).              |
| Hy3 Preview Free      | `opencode/hy3-preview-free`      | Deprecated on models.dev and absent from Zen (October 2026).                                                                                    |
| Ling 2.6 Flash Free   | `opencode/ling-2.6-flash-free`   | Deprecated on models.dev and absent from Zen (October 2026).                                                                                    |
| Qwen 3.6 Plus Free    | `opencode/qwen3.6-plus-free`     | Free promotion ended (April 2026) — now requires OpenCode Go subscription. See [issue #242](https://github.com/link-assistant/agent/issues/242) |
| Kimi K2.5 Free        | `opencode/kimi-k2.5-free`        | Removed from OpenCode Zen (March 2026) — see [issue #208](https://github.com/link-assistant/agent/issues/208)                                   |
| Grok Code Fast 1      | `opencode/grok-code`             | Discontinued January 2026                                                                                                                       |
| MiniMax M2.1 Free     | `opencode/minimax-m2.1-free`     | Replaced by `opencode/minimax-m2.5-free`                                                                                                        |
| GLM 4.7 Free          | `opencode/glm-4.7-free`          | No longer free on OpenCode Zen                                                                                                                  |
| Kimi K2.5 (Kilo)      | `kilo/kimi-k2.5-free`            | Replaced by other Kilo free models                                                                                                              |
| MiniMax M2.1 (Kilo)   | `kilo/minimax-m2.1-free`         | Replaced by `kilo/minimax-m2.5-free`                                                                                                            |

---

## Choosing Between Providers

### Use OpenCode Zen when:

- Your credentials or client are eligible for Zen access
- You prefer the catalogue-listed `big-pickle` default with a 200,000 token context window
- You need a simple, curated list of models

### Use Kilo Gateway when:

- You want access to GLM-5 (currently free, limited time)
- You need larger context windows (up to 256,000 tokens)
- You want more free model options

### Model Routing

The agent intelligently routes model requests:

- `big-pickle` without provider prefix → OpenCode Zen (`opencode/big-pickle`)
- `ling-3.1-flash-free` without provider prefix → OpenCode Zen (`opencode/ling-3.1-flash-free`)
- Explicit `provider/model` → that provider, without cross-provider fallback

MiniMax M2.5 Free is no longer treated as shared between Zen and Kilo. Existing explicit model overrides remain available, subject to the provider's current catalogue.

## Checking Default Model Availability

Run `bun scripts/check-default-models.mjs` from the repository root. The check validates the shipped default, single compaction model, and every cascade entry against Zen's live catalogue or non-deprecated models.dev metadata. The `same` entry refers to the shipped default, and environment overrides do not affect the check. CI runs it on changes to these defaults and daily to catch provider withdrawals. It checks catalogue availability without making inference calls.

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
