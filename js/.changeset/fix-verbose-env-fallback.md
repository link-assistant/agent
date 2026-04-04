---
'@link-assistant/agent': minor
---

feat: centralize agent config with lino-arguments, always log resolved config (#227)

- Added `lino-arguments` for unified env var resolution (case-insensitive, .lenv support)
- Created centralized `AgentConfig` module as single source of truth for all configuration
- All env vars resolved via `getenv()` from lino-arguments (CLI args > env vars > .lenv > defaults)
- Always log resolved configuration as JSON at startup for debugging
- Moved all direct `process.env` reads (MCP, read tool) into centralized Flag module
- `--verbose` is now the most reliable flag: triple-checked via in-memory, AgentConfig, and env var
- Removed all `OPENCODE_*` env var support; use `LINK_ASSISTANT_AGENT_*` exclusively
