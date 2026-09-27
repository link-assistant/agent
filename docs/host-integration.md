# Host Integration: Supplying Configuration

A host that embeds the Agent CLI — a task runner, an orchestrator such as Hive Mind, a client registry — usually needs to hand it a generated configuration: a provider pointing at the host's server, a model, permissions. The CLI reads that configuration from three environment variables. They are the supported integration contract.

| Variable                              | Value                                        | Loaded as                                                                           |
| ------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `LINK_ASSISTANT_AGENT_CONFIG_DIR`     | A directory                                  | `opencode.json` / `opencode.jsonc` in it, plus its `command/`, `agent/` and `mode/` |
| `LINK_ASSISTANT_AGENT_CONFIG`         | Path to one config file (`.json` / `.jsonc`) | That file                                                                           |
| `LINK_ASSISTANT_AGENT_CONFIG_CONTENT` | The configuration itself, as a JSON string   | That JSON                                                                           |

Use whichever fits the host; they can be combined. All three are read at startup in `js/src/config/config.ts` and merged in `js/src/config/file-config.ts`, in this order (later entries win):

1. the user's global config, `$XDG_CONFIG_HOME/link-assistant-agent/` (`~/.config/link-assistant-agent/` by default)
2. `LINK_ASSISTANT_AGENT_CONFIG`
3. `opencode.json` / `opencode.jsonc` found in the project
4. `LINK_ASSISTANT_AGENT_CONFIG_CONTENT`
5. the project's `.link-assistant-agent/` directories
6. `LINK_ASSISTANT_AGENT_CONFIG_DIR`

## Example

```bash
mkdir -p /run/host/agent-config
cat > /run/host/agent-config/opencode.json <<'EOF'
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "formal-ai": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://127.0.0.1:18080/api/openai/v1",
        "apiKey": "{env:FORMAL_AI_API_KEY}"
      },
      "models": { "formal-ai": { "name": "formal-ai" } }
    }
  }
}
EOF

LINK_ASSISTANT_AGENT_CONFIG_DIR=/run/host/agent-config \
  agent --model formal-ai/formal-ai -p "hi"
```

Or, without a file on disk:

```bash
LINK_ASSISTANT_AGENT_CONFIG_CONTENT='{"provider":{"formal-ai":{"models":{"formal-ai":{"limit":{"context":null}}}}}}' \
  agent --model formal-ai/formal-ai -p "hi"
```

## Do Not Relocate `XDG_CONFIG_HOME`

It is tempting to write `link-assistant-agent/opencode.json` into a scratch directory and point `XDG_CONFIG_HOME` at it. Don't. `XDG_CONFIG_HOME` is not the agent's variable: every tool the agent runs inherits it. `gh` reads its login from `$XDG_CONFIG_HOME/gh/hosts.yml`, `git` reads `$XDG_CONFIG_HOME/git/config`, and so on. Relocate it and the `bash` tool calls in the session run as a stranger — `gh auth status` fails, pushes and PR updates fail, and the session cannot finish its work even though the caller is signed in.

This is what happened in the 2026-09-27 Scala run behind [#314](https://github.com/link-assistant/agent/issues/314): the host relocated `XDG_CONFIG_HOME` to deliver the agent's config, and `gh` inside the session came up unauthenticated.

Leave `XDG_CONFIG_HOME` as the caller has it and use `LINK_ASSISTANT_AGENT_CONFIG_DIR` (or one of the other two variables) instead. `js/tests/host-config-contract.ts` checks both halves: config delivered through `LINK_ASSISTANT_AGENT_CONFIG_DIR` is honoured, and a `bash` tool call in that session still sees the caller's config home — and, where the caller is signed in to `gh`, `gh auth status` exits 0.

### The startup hint

When `XDG_CONFIG_HOME` is set to anything other than `~/.config` and none of the three variables above is set, the CLI logs one warning at startup:

```json
{
  "type": "log",
  "level": "warn",
  "message": "XDG_CONFIG_HOME is relocated",
  "xdgConfigHome": "/tmp/host-generated",
  "realConfigHome": "/home/user/.config",
  "hint": "To supply agent config, set LINK_ASSISTANT_AGENT_CONFIG_DIR, LINK_ASSISTANT_AGENT_CONFIG, LINK_ASSISTANT_AGENT_CONFIG_CONTENT instead of XDG_CONFIG_HOME: tools the agent runs (gh, git) read their config and credentials from XDG_CONFIG_HOME too"
}
```

It appears in the `--verbose` stream, and in the log file otherwise. Setting any of the three variables tells the CLI the host is using the contract, and the hint goes away.
