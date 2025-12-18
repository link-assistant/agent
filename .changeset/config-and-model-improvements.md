---
'@link-assistant/agent': minor
---

Add support for link-assistant-agent branding and improve default model selection

**New Features:**

- Default model is now `opencode/grok-code` (Open Code Zen / Grok Code Fast 1)
- Support for `LINK_ASSISTANT_AGENT_*` environment variable prefix (backwards compatible with `OPENCODE_*`)
- Support for `.link-assistant-agent` config directory (backwards compatible with `.opencode`)
- Global config paths now use `link-assistant-agent` name

**Breaking Changes:**

- Global config directory changed from `~/.config/opencode/` to `~/.config/link-assistant-agent/`
  - Users should manually migrate global configs if needed

**Migration:**

- Environment variables: New `LINK_ASSISTANT_AGENT_*` prefix available; old `OPENCODE_*` still works
- Project config: Both `.opencode/` and `.link-assistant-agent/` directories supported
- Model override: Use `"model": "provider/model-id"` in config to override default
