# Case Study: Kilo Provider Integration with Free Models

## Issue Reference
- Issue: [#159](https://github.com/link-assistant/agent/issues/159)
- Title: Similar to how we have free models of OpenCode Zen add automatically supported free models of https://github.com/Kilo-Org/kilo
- Labels: documentation, enhancement

## Background

The Link Assistant Agent already supports free models through the OpenCode Zen subscription service. This issue requests adding similar support for free models available through the [Kilo](https://github.com/Kilo-Org/kilo) platform, with a focus on GLM-5.

## Research Summary

### What is Kilo?

[Kilo](https://kilo.ai) is an open-source AI coding agent platform that provides:
- CLI tool (`@kilocode/cli`) and VS Code extension (700K+ downloads)
- Access to 500+ AI models through the Kilo Gateway
- Free tier with default free models and $5 initial credit
- OpenAI-compatible API at `https://api.kilo.ai/api/gateway`

### Kilo Gateway Technical Details

| Property | Value |
|----------|-------|
| Base URL | `https://api.kilo.ai/api/gateway` |
| API Format | OpenAI-compatible (`/chat/completions`) |
| Authentication | API Key (Bearer token) |
| Environment Variable | `KILO_API_KEY` |
| Features | SSE streaming, tool calling, BYOK support |

### Available Free Models

#### Through Kilo Gateway (No API Key Required for Free Tier)

| Model | Provider | Status | Description |
|-------|----------|--------|-------------|
| GLM-5 | Z.AI (Zhipu AI) | Free (limited time) | Flagship model, matches Opus 4.5 on many tasks |
| GLM 4.7 | Z.AI | Free | Agent-centric, open-weight model |
| Kimi K2.5 | MoonshotAI | Free | Agentic capabilities, tool use, code synthesis |
| MiniMax M2.1 | MiniMax | Free | Strong general-purpose performance |
| Giga Potato | Unknown | Free (evaluation) | Stealth release model |
| Trinity Large Preview | Arcee AI | Free | Preview model |

### GLM-5 Specifications

| Property | Value |
|----------|-------|
| Model ID | `z-ai/glm-5` |
| Release Date | February 11, 2026 |
| Context Window | 202,752 tokens |
| Max Output Tokens | 131,072 tokens |
| Input Cost | $0.80 per 1M tokens (paid tier) |
| Output Cost | $2.56 per 1M tokens (paid tier) |
| Cache Read Cost | $0.00 per 1M tokens |
| Capabilities | Function calling, tool choice, JSON schema validation, reasoning tokens |
| Input Modalities | Text only |

### Comparison with OpenCode Zen Free Models

| Feature | OpenCode Zen | Kilo Gateway |
|---------|--------------|--------------|
| Free Models | Kimi K2.5, MiniMax M2.1, GPT 5 Nano, GLM 4.7, Big Pickle | GLM-5, GLM 4.7, Kimi K2.5, MiniMax M2.1, Giga Potato, Trinity Large |
| API Format | OpenAI-compatible | OpenAI-compatible |
| API Key | `public` for free models | Required (free tier available) |
| Default Model | kimi-k2.5-free | GLM-5 (free limited time) |

## Solution Approach

### Implementation Strategy

1. **Add Kilo Provider** - Create a new provider in `provider.ts` that:
   - Uses the `@ai-sdk/openai-compatible` package
   - Connects to `https://api.kilo.ai/api/gateway`
   - Supports free models without API key (or with free tier)
   - Supports BYOK (Bring Your Own Key) for paid models

2. **Model Configuration** - Add Kilo models to the configuration:
   - Free models with `cost: { input: 0, output: 0 }`
   - Model IDs in format `kilo/<provider>/<model>` (e.g., `kilo/z-ai/glm-5`)

3. **Documentation** - Update MODELS.md with:
   - Kilo provider section
   - Free models table
   - Usage examples

### Code Changes Required

1. `js/src/provider/provider.ts` - Add Kilo custom loader
2. `MODELS.md` - Add Kilo provider documentation
3. `docs/kilo.md` - Create detailed Kilo documentation (optional)

## Sources

- [Kilo GitHub Repository](https://github.com/Kilo-Org/kilo)
- [Kilo Code GitHub Repository](https://github.com/Kilo-Org/kilocode)
- [Kilo Gateway Documentation](https://kilo.ai/docs/gateway)
- [Kilo AI Gateway](https://kilo.ai/gateway)
- [GLM-5 Model Page](https://kilo.ai/models/z-ai-glm-5)
- [Free and Budget Models](https://kilo.ai/docs/advanced-usage/free-and-budget-models)
- [GLM-5 Free Announcement](https://blog.kilo.ai/p/glm-5-free-limited-time)
- [Pony Alpha is GLM-5](https://blog.kilo.ai/p/the-secret-is-out-pony-alpha-is-glm)
- [Z.AI Developer Documentation](https://docs.z.ai/devpack/overview)
- [VentureBeat: Kilo CLI 1.0](https://venturebeat.com/orchestration/kilo-cli-1-0-brings-open-source-vibe-coding-to-your-terminal-with-support)
