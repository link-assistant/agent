# Free Models

The agent's default is **Nemotron 3 Super on Kilo Gateway**. For reliable gateway access, run `agent auth login` and select Kilo Gateway, or set `KILO_API_KEY`. Anonymous access is subject to gateway restrictions.

> **Last checked:** October 12, 2026 against the [Kilo model catalog](https://api.kilo.ai/api/gateway/models) and [OpenCode Zen model catalog](https://opencode.ai/zen/v1/models).

## Quick Start

```bash
agent auth login # Select Kilo Gateway
# Or: export KILO_API_KEY=your_api_key_here
echo "hello" | agent
echo "hello" | agent --model kilo/nemotron-3-super-free
```

## Kilo Gateway Free Models

These are the maintained built-in aliases. The gateway may offer additional models.

| Model                          | Agent model ID                     | Gateway ID                               | Context   | Agent output limit |
| ------------------------------ | ---------------------------------- | ---------------------------------------- | --------- | ------------------ |
| **Nemotron 3 Super (default)** | `kilo/nemotron-3-super-free`       | `nvidia/nemotron-3-super-120b-a12b:free` | 262,144   | 32,768             |
| Nemotron 3 Ultra               | `kilo/nemotron-3-ultra-free`       | `nvidia/nemotron-3-ultra-550b-a55b:free` | 1,000,000 | 65,536             |
| Nemotron 3.5 Lightning         | `kilo/nemotron-3.5-lightning-free` | `nvidia/nemotron-3.5-lightning:free`     | 1,000,000 | 65,536             |

All three support reasoning and tool calls with zero input/output cost. Super's output limit is conservatively capped at 32,768 in Agent.

```bash
echo "hello" | agent --model kilo/nemotron-3-ultra-free
echo "hello" | agent --model kilo/nemotron-3.5-lightning-free
```

The default compaction cascade is:

```text
(kilo/nemotron-3-super-free kilo/nemotron-3-ultra-free kilo/nemotron-3.5-lightning-free same)
```

Session titles and summaries use the resolved compaction model, falling back to the session model if it cannot be loaded. The default single compaction model is also `kilo/nemotron-3-super-free`. Explicit `--model` runs on other providers inherit that provider for secondary calls; explicitly configured compaction models remain authoritative. See [issue #307](https://github.com/link-assistant/agent/issues/307).

## OpenCode Zen Free Tier

Zen's catalog still lists free endpoints, including these maintained entries:

| Model                  | Model ID                               | Context   |
| ---------------------- | -------------------------------------- | --------- |
| Big Pickle             | `opencode/big-pickle`                  | 200,000   |
| Nemotron 3.5 Lightning | `opencode/nemotron-3.5-lightning-free` | 1,000,000 |

**Zen restricts free inference to OpenCode clients.** Agent calls can receive HTTP 403 `FreeTierError` even when an ID is present in the catalog. Agent reports this restriction and does not retry it. These endpoints are excluded from Agent's defaults; use authenticated Kilo or a paid provider instead. See [issue #327](https://github.com/link-assistant/agent/issues/327#issuecomment-6040047705).

## Withdrawn Entries

The following former built-ins have been removed rather than silently remapped to a different model:

- Zen: `nemotron-3-super-free`, `nemotron-3-ultra-free`, `minimax-m2.5-free`, `hy3-preview-free`, `ling-2.6-flash-free`.
- Kilo: `glm-5-free`, `glm-4.5-air-free`, `minimax-m2.5-free`, `giga-potato-free`, `trinity-large-preview`, `deepseek-r1-free`.

Earlier withdrawals include Zen's `qwen3.6-plus-free`, `kimi-k2.5-free`, `grok-code`, `minimax-m2.1-free`, and `glm-4.7-free`. `opencode/gpt-5-nano` appears in today's catalog but is no longer advertised as a free compaction default. Availability alone does not establish free pricing.

## Model Routing and Drift Checks

The short names `nemotron-3-super-free`, `nemotron-3-ultra-free`, and `nemotron-3.5-lightning-free` resolve to Kilo. An explicit provider prefix selects that provider.

```bash
cd js
npm run check:model-drift
```

The **Free Model Drift** workflow runs daily, on relevant pull requests, and manually. It checks exact gateway IDs for Kilo aliases and maintained Zen IDs against both live catalogs, fails on withdrawals or unavailable/malformed catalogs, and saves diagnostics as an artifact. It checks availability; authentication, client restrictions, pricing, and successful inference are separate concerns.

## More Information

- [Full Models Documentation](MODELS.md)
- [Kilo Gateway Documentation](docs/kilo.md)
- [Kilo Privacy Policy](https://kilo.ai/privacy)
- [OpenCode Zen Documentation](https://opencode.ai/docs/zen/)
