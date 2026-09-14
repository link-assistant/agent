# Formal AI Provider

[Formal AI](https://github.com/link-assistant/formal-ai) is a local symbolic assistant server with OpenAI-compatible API routes. Agent can use it without a custom provider config through these selectors:

| Selector                    | Notes                                                             |
| --------------------------- | ----------------------------------------------------------------- |
| `formal-ai`                 | Short model alias, resolved to `formal-ai/formal-ai`              |
| `formal-ai/formal-ai`       | Canonical Agent provider/model form                               |
| `@link-assistant/formal-ai` | Scoped Formal AI alias accepted by Agent                          |
| `formalai/formal-ai`        | Compatibility alias used by Formal AI's OpenCode wrapper examples |

Agent sends all of these to the Formal AI server as the canonical model id `formal-ai`.

## Quick Start

1. Install the Formal AI CLI:

   ```bash
   cargo install formal-ai
   ```

   You can also use Formal AI's universal installer:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/link-assistant/formal-ai/main/scripts/install.sh | sh -s -- cli
   ```

2. Start the local server with agent mode enabled:

   ```bash
   formal-ai serve --agent-mode --host 127.0.0.1 --port 8080
   ```

3. Export a client API key. If the server was started with `FORMAL_AI_API_BEARER_TOKEN`, this value must match it. If no bearer token is configured, any non-empty value is enough for clients that require an API key.

   ```bash
   export FORMAL_AI_API_KEY="local-test-token"
   ```

4. Run Agent with a Formal AI selector:

   ```bash
   agent --model formal-ai --permission-mode plan -p "run ls to list files here"
   agent --model @link-assistant/formal-ai --permission-mode plan -p "hi"
   agent --model formalai/formal-ai --permission-mode plan -p "hi"
   ```

Use `--permission-mode plan` when you want Agent to allow read-only shell commands such as `ls` after approval. Use `--read-only` when shell execution should be disabled entirely.

## Server Checks

Before running Agent, verify the Formal AI server is reachable:

```bash
curl -s http://127.0.0.1:8080/health
curl -s http://127.0.0.1:8080/api/openai/v1/models
```

The OpenAI-compatible base URL that Agent uses by default is:

```text
http://127.0.0.1:8080/api/openai/v1
```

## Remote Servers and Non-Default Ports

Set `FORMAL_AI_BASE_URL` when the server is on another host, port, or reverse proxy. Include the OpenAI protocol path:

```bash
export FORMAL_AI_BASE_URL="http://127.0.0.1:18080/api/openai/v1"
export FORMAL_AI_API_KEY="local-test-token"
agent --model formal-ai -p "hi"
```

For persistent config, you can still override the built-in provider:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "formal-ai": {
      "name": "formal-ai local server",
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://127.0.0.1:18080/api/openai/v1",
        "apiKey": "{env:FORMAL_AI_API_KEY}"
      },
      "models": {
        "formal-ai": {
          "name": "formal-ai"
        }
      }
    }
  },
  "model": "formal-ai/formal-ai"
}
```

## Secondary Calls: Compaction and Session Summaries

Besides the turn itself, Agent makes two kinds of secondary model calls: context compaction, and the session summary that produces a title and a short description. Both use the compaction model.

The shipped compaction default names OpenCode models. When `--model` points at another provider — Formal AI included — those entries are dropped and the secondary calls use `--model` instead, so a Formal AI run never contacts OpenCode. Naming a compaction model yourself keeps whatever you wrote:

```bash
# Secondary calls go to Formal AI, like the turn itself.
agent --model formal-ai -p "hi"

# Secondary calls go where you sent them.
agent --model formal-ai --compaction-model opencode/gpt-5-nano -p "hi"
```

### Turning Summaries Off for a Model Without a Context Limit

Compaction and summarization exist to keep a conversation inside a context window. A model that has none has no use for either, and an integrator should not have to remember `--no-summarize-session` on every run. Declare the capability once in the provider config, as `"context": null`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "formal-ai": {
      "models": {
        "formal-ai": {
          "limit": { "context": null }
        }
      }
    }
  }
}
```

`"unlimited": true` on the model is the same statement:

```json
{
  "provider": {
    "formal-ai": { "models": { "formal-ai": { "unlimited": true } } }
  }
}
```

With either spelling, Agent skips compaction, reports no context diagnostics, and makes no summarization call for that model. The local part of the summary — the per-message diff stat — is still recorded, because it costs no API call.

## `formal-ai with` and `with-formal-ai`

Formal AI also ships wrapper commands for other CLIs:

```bash
formal-ai with --start-server codex "hi"
formal-ai with opencode run "hi"
formal-ai with gemini -p "hi"

with-formal-ai -g codex
with-formal-ai -g opencode
with-formal-ai -g gemini
with-formal-ai -g --all
with-formal-ai -g --undo codex
```

Agent does not require a wrapper or generated config for the built-in selectors above. The wrappers are still useful for Codex, OpenCode, Gemini, and other clients that need per-tool config files or protocol-specific environment variables.

## Troubleshooting

### `ProviderModelNotFoundError` for `formal-ai`

Use an Agent version that includes the built-in Formal AI provider. Older Agent versions require the manual provider config shown above.

### Connection refused, `fetch failed`, or server unavailable

Start the server and check the base URL:

```bash
formal-ai serve --agent-mode --host 127.0.0.1 --port 8080
curl -s http://127.0.0.1:8080/health
```

If you use a remote host or non-default port, set `FORMAL_AI_BASE_URL` to the full OpenAI-compatible path ending in `/api/openai/v1`.

### 401 or 403 authentication errors

If the server was started with `FORMAL_AI_API_BEARER_TOKEN`, export the same value as `FORMAL_AI_API_KEY` before running Agent:

```bash
FORMAL_AI_API_BEARER_TOKEN="local-test-token" formal-ai serve --agent-mode --host 127.0.0.1 --port 8080
export FORMAL_AI_API_KEY="local-test-token"
```

### No tool calls are produced

Start the server with `--agent-mode`. Agent mode makes Formal AI emit tool calls for requests such as listing files, while Agent remains responsible for deciding whether tools are allowed.

### The log shows HTTP 400 from `opencode` during a Formal AI run

`"OpenCode's free tier can only be used in OpenCode"` came from the session summary and compaction reusing the shipped OpenCode compaction default. Since Agent 0.26.3 those defaults follow `--model`, so upgrading is the fix; on older versions, pass `--compaction-models '(same)'` or `--no-summarize-session`.

### `link-assistant/formal-ai` does not select Formal AI in Agent

Formal AI's HTTP API accepts `link-assistant/formal-ai`, but Agent already uses the `link-assistant` provider namespace internally. Use `@link-assistant/formal-ai`, `formal-ai`, or `formal-ai/formal-ai` in Agent.
