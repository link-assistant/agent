# Stdin Mode Documentation

This document describes the comprehensive stdin handling features added in Issue #76.

## Overview

The Agent CLI provides flexible stdin handling with support for:

- **Piped input** - Read from stdin when input is piped (`echo "hi" | agent`)
- **Direct prompts** - Use `-p`/`--prompt` flag to bypass stdin
- **TTY detection** - Enter interactive mode when running in a terminal (TTY)
- **Input queuing** - Queue and merge rapidly arriving input lines
- **Interactive mode** - Accept both JSON and plain text (default)
- **Non-interactive mode** - Accept only JSON input

## Quick Start

### Basic Usage

```bash
# Plain text input
echo "Hello, how are you?" | agent

# JSON input
echo '{"message":"Hello, how are you?"}' | agent

# Direct prompt (no stdin)
agent -p "Hello, how are you?"
```

### TTY Detection (Interactive Terminal Mode)

When running `agent` in an interactive terminal (TTY), it enters interactive terminal mode where you can type messages directly:

```bash
# In terminal - enters interactive mode, accepts typed input
agent
# Output: status message with mode "interactive-terminal"
# Type your message and press Enter

# Show help and exit (old behavior)
agent --no-always-accept-stdin

# With piped input - enters stdin stream mode
echo "hi" | agent
```

### Interactive Mode with Multiple Inputs

The agent supports continuous multi-turn conversations in interactive terminal mode. When you run `agent` without piped input, it enters listening mode and accepts multiple messages sequentially, maintaining context across the conversation.

**📖 For a complete interactive example with detailed explanations, see:** [examples/interactive-mode-multi-turn.md](../examples/interactive-mode-multi-turn.md)

**📄 Want to see the raw terminal output?** Check out [examples/interactive-mode-output.txt](../examples/interactive-mode-output.txt) for the original unedited output

**Example Session:**

```bash
$ agent
```

**Output:**

```json
{
  "type": "status",
  "mode": "interactive-terminal",
  "message": "Agent CLI in interactive terminal mode. Type your message and press Enter.",
  "hint": "Press CTRL+C to exit. Use --help for options.",
  "acceptedFormats": ["JSON object with \"message\" field", "Plain text"],
  "options": {
    "interactive": true,
    "autoMergeQueuedMessages": true,
    "alwaysAcceptStdin": true,
    "compactJson": false
  }
}
```

**User types:** `hi`

**Output:**

```json
{
  "type": "step_start",
  "timestamp": 1766311438146,
  "sessionID": "ses_4bfa26db0ffeRkIzLa0XHXrOFX",
  "part": {
    "id": "prt_b405da7400010UjcSOuZnSfLAf",
    "sessionID": "ses_4bfa26db0ffeRkIzLa0XHXrOFX",
    "messageID": "msg_b405da0c5001OUH0I06yBDjpqo",
    "type": "step-start"
  }
}
{
  "type": "text",
  "timestamp": 1766311439905,
  "sessionID": "ses_4bfa26db0ffeRkIzLa0XHXrOFX",
  "part": {
    "id": "prt_b405dadab001HzaE19EvBKuiRR",
    "sessionID": "ses_4bfa26db0ffeRkIzLa0XHXrOFX",
    "messageID": "msg_b405da0c5001OUH0I06yBDjpqo",
    "type": "text",
    "text": "Hello! How can I help you today?",
    "time": {
      "start": 1766311439904,
      "end": 1766311439904
    }
  }
}
{
  "type": "step_finish",
  "timestamp": 1766311439909,
  "sessionID": "ses_4bfa26db0ffeRkIzLa0XHXrOFX",
  "part": {
    "id": "prt_b405dae24001VUScXByqNzrfcl",
    "sessionID": "ses_4bfa26db0ffeRkIzLa0XHXrOFX",
    "messageID": "msg_b405da0c5001OUH0I06yBDjpqo",
    "type": "step-finish",
    "reason": "stop",
    "cost": 0,
    "tokens": {
      "input": 8515,
      "output": 9,
      "reasoning": 125,
      "cache": {
        "read": 192,
        "write": 0
      }
    }
  }
}
```

**User types:** `who are you?`

**Output:**

```json
{
  "type": "step_start",
  "timestamp": 1766311457818,
  "sessionID": "ses_4bfa26db0ffeRkIzLa0XHXrOFX",
  "part": {
    "id": "prt_b405df418001uPavQoB76hY1KL",
    "sessionID": "ses_4bfa26db0ffeRkIzLa0XHXrOFX",
    "messageID": "msg_b405defcf001Gil2F3fWY5XIb7",
    "type": "step-start"
  }
}
{
  "type": "text",
  "timestamp": 1766311458745,
  "sessionID": "ses_4bfa26db0ffeRkIzLa0XHXrOFX",
  "part": {
    "id": "prt_b405df5f4001oVeAYaU2Rko3ia",
    "sessionID": "ses_4bfa26db0ffeRkIzLa0XHXrOFX",
    "messageID": "msg_b405defcf001Gil2F3fWY5XIb7",
    "type": "text",
    "text": "I'm Grok, an AI agent built by xAI, powered by the Grok Code Fast 1 model. I'm designed to help with a wide range of tasks, from answering questions and providing information to assisting with coding, research, and more. I have access to various tools to fetch data, run commands, edit files, and perform other functions when needed. What can I do for you?",
    "time": {
      "start": 1766311458744,
      "end": 1766311458744
    }
  }
}
{
  "type": "step_finish",
  "timestamp": 1766311458746,
  "sessionID": "ses_4bfa26db0ffeRkIzLa0XHXrOFX",
  "part": {
    "id": "prt_b405df7ba001WU2YgPNQ1aRqDB",
    "sessionID": "ses_4bfa26db0ffeRkIzLa0XHXrOFX",
    "messageID": "msg_b405defcf001Gil2F3fWY5XIb7",
    "type": "step-finish",
    "reason": "stop",
    "cost": 0,
    "tokens": {
      "input": 23,
      "output": 80,
      "reasoning": 70,
      "cache": {
        "read": 8832,
        "write": 0
      }
    }
  }
}
```

**Key Features Demonstrated:**

1. **Continuous Listening:** The agent doesn't exit after the first response; it continues to accept input
2. **Session Persistence:** Notice the `sessionID` remains the same (`ses_4bfa26db0ffeRkIzLa0XHXrOFX`) across both messages, maintaining conversation context
3. **Plain Text Input:** Both inputs (`hi` and `who are you?`) are plain text, automatically converted to JSON messages
4. **Streaming JSON Events:** Each response includes `step_start`, `text`, and `step_finish` events with detailed metadata
5. **Token Usage Tracking:** Each `step_finish` event includes token counts for input, output, reasoning, and cache usage

**To Exit:**

- Press `CTRL+C` to exit the agent
- Send EOF (Ctrl+D on Unix, Ctrl+Z on Windows)
- Close your terminal

This interactive mode makes it easy to have multi-turn conversations with the agent without needing to restart the process for each question.

**💡 Tip:** For a more detailed breakdown of this example with comprehensive explanations of each feature, see the [Interactive Mode Multi-Turn Example](../examples/interactive-mode-multi-turn.md).

## CLI Flags

### `-p, --prompt <text>`

Send a prompt directly without reading from stdin.

```bash
agent -p "What is 2+2?"
```

This is useful for:

- One-off queries
- Scripts where you don't want to pipe input
- Avoiding stdin buffering issues

### `--disable-stdin`

Explicitly disable stdin streaming. Requires `--prompt` or shows an error.

```bash
# This will show an error with a suggestion to use -p
agent --disable-stdin

# This works
agent --disable-stdin -p "Hello"
```

### `--stdin-stream-timeout <ms>`

Set a timeout in milliseconds for stdin reading. If no input is received within the timeout, the agent exits.

```bash
# Wait for input for 5 seconds
agent --stdin-stream-timeout 5000
```

**Default:** No timeout (wait indefinitely until EOF)

### `--interactive / --no-interactive`

Control whether plain text input is accepted.

```bash
# Default: accept both JSON and plain text
echo "Hello" | agent

# Only accept JSON input
echo '{"message":"Hello"}' | agent --no-interactive

# Plain text will be rejected in non-interactive mode
echo "Hello" | agent --no-interactive  # Error!
```

**Default:** Interactive mode is enabled (`--interactive`)

### `--auto-merge-queued-messages / --no-auto-merge-queued-messages`

Control whether rapidly arriving input lines are merged into a single message.

```bash
# Default: merge multi-line input into one message
printf 'Line 1\nLine 2\nLine 3' | agent

# Treat each line as a separate message
printf 'Line 1\nLine 2\nLine 3' | agent --no-auto-merge-queued-messages
```

**Default:** Auto-merge is enabled (`--auto-merge-queued-messages`)

### `--always-accept-stdin / --no-always-accept-stdin`

Control whether the agent keeps listening for input after processing each message.

```bash
# Default: continuous listening mode - keeps accepting input until EOF or Ctrl+C
echo '{"message":"hi"}' | agent

# Single-message mode - exit after first response (legacy behavior)
echo '{"message":"hi"}' | agent --no-always-accept-stdin
```

In continuous mode (default):

- The agent keeps the session alive between messages
- You can send multiple messages and they will be queued
- The agent maintains conversation context across messages
- Press Ctrl+C or send EOF to exit

**Default:** Always accept stdin is enabled (`--always-accept-stdin`)

### `--compact-json`

Output compact JSON (single line) instead of pretty-printed JSON.

```bash
# Default: pretty-printed JSON output
echo "hi" | agent

# Compact JSON for program-to-program communication
echo "hi" | agent --compact-json
```

Compact mode is useful for:

- Parsing output with tools like `jq`
- Reducing bandwidth in automated pipelines
- Machine-to-machine communication

**Default:** Pretty-printed JSON (compact-json is disabled)

## Input Formats

### Plain Text

Plain text input is automatically converted to a JSON message:

```bash
echo "Hello, world!" | agent
```

Internally becomes:

```json
{ "message": "Hello, world!" }
```

### JSON Object

JSON objects are passed through directly:

```bash
echo '{"message":"Hello","tools":[]}' | agent
```

### Multi-line Input

When auto-merge is enabled (default), multi-line input is merged:

```bash
printf 'First line\nSecond line\nThird line' | agent
```

Becomes a single message: "First line\nSecond line\nThird line"

## Live `stream-json` Contract

For bidirectional drivers such as hive-mind, use continuous stdin with
Claude-compatible JSONL input and output:

```bash
agent --input-format stream-json --output-format stream-json
```

Each stdin line must be one complete JSON object. Supported frame types:

| Frame                                    | Direction       | Behavior                                                                                                                    |
| ---------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `{"type":"user_prompt","content":"..."}` | driver -> agent | Queues a user turn. `{"type":"user", ...}` frames with text content are accepted too.                                       |
| `{"type":"system","content":"..."}`      | driver -> agent | Replaces the system message used for subsequent turns.                                                                      |
| `{"type":"interrupt"}`                   | driver -> agent | Requests cancellation of the active prompt and moves the session back to idle. It does not start a new user turn by itself. |
| `{"type":"permission_response", ...}`    | driver -> agent | Resolves a pending `permission_request` without waiting for the turn to finish. See [permissions](permissions.md).          |

### Session Resume

`--resume <sessionID>` is the stable resume entry point. By default it forks
the requested session to preserve the original history and continues in the
forked session. Add `--no-fork` to continue in the exact same session:

```bash
agent --resume ses_abc123 --no-fork --input-format stream-json --output-format stream-json
```

Output events identify the active session. OpenCode output uses `sessionID`;
Claude `stream-json` output uses `session_id`. When `--resume` forks, the first
`init`, `message`, `result`, or `idle` event contains the forked session id.
When `--resume --no-fork` is used, those events contain the requested session id.

### User-Frame Replay

When a `user_prompt` or `user` frame is actually consumed, the agent replays it
on stdout as an acknowledgement. In Claude `stream-json` output this is a user
message:

```json
{
  "type": "message",
  "timestamp": "2026-07-03T00:00:00.000Z",
  "session_id": "ses_abc123",
  "role": "user",
  "content": [{ "type": "text", "text": "new issue comment" }]
}
```

If the agent is busy, user frames are queued and replayed only when they become
the active turn. This lets a driver distinguish "accepted on stdin" from
"delivered to the conversation".

### Interrupt And Queuing Semantics

`{"type":"interrupt"}` requests an immediate abort of the active prompt. The
agent then emits the idle signal below when the session is safe for another
turn. User frames that arrive while the active prompt is stopping remain queued
and are processed after that idle boundary.

### Idle / Turn Boundary Signal

At the end of each turn, and after an interrupt cancellation settles, the agent
emits an explicit idle event.

OpenCode output:

```json
{
  "type": "session_idle",
  "timestamp": 1718630400000,
  "sessionID": "ses_abc123"
}
```

Claude `stream-json` output:

```json
{
  "type": "idle",
  "timestamp": "2026-07-03T00:00:00.000Z",
  "session_id": "ses_abc123"
}
```

Drivers can flush queued `user_prompt` frames after this event instead of
interrupting an in-progress turn.

### Error Events

Every emitted `error` event carries a human-readable `message` string next to
the machine-readable `error` payload, so consumers never have to re-derive the
text (and never publish `[object Object]`):

```json
{
  "type": "error",
  "timestamp": 1718630400000,
  "sessionID": "ses_abc123",
  "message": "RetryTimeoutExceededError: Retry timeout exceeded after 604800s",
  "error": {
    "name": "RetryTimeoutExceededError",
    "data": { "message": "Retry timeout exceeded after 604800s" }
  }
}
```

The `error` field is unchanged — `message` is purely additive. Consumers should
prefer `record.message` and fall back to rendering `record.error` themselves.

#### `error` Means The Turn Or Session Failed

A top-level `error` event is reserved for failures that end the turn or the
session (a provider error, a retry timeout, invalid input). Consumers may treat
it as fatal.

A failed tool call is **not** such a failure. The model receives the tool's
error as an ordinary tool result and usually recovers (reads another file,
fixes an edit anchor, retries a command). It is therefore reported only on the
tool's own event and never as a top-level `error` event
([#332](https://github.com/link-assistant/agent/issues/332)).

OpenCode output — `tool_use` with `part.state.status: "error"`:

```json
{
  "type": "tool_use",
  "timestamp": 1718630400000,
  "sessionID": "ses_abc123",
  "part": {
    "type": "tool",
    "tool": "read",
    "state": {
      "status": "error",
      "input": { "filePath": "/repo/missing.txt" },
      "error": "Error: File not found: /repo/missing.txt"
    }
  }
}
```

Claude `stream-json` output — a `tool_result` with `status: "error"`, written
to stdout like every other tool result:

```json
{
  "type": "tool_result",
  "timestamp": "2026-07-03T00:00:00.000Z",
  "session_id": "ses_abc123",
  "tool_use_id": "prt_abc123",
  "output": "Error: File not found: /repo/missing.txt",
  "status": "error"
}
```

## Status Messages

When entering listening mode, the CLI outputs a JSON status message (pretty-printed by default).

### Interactive Terminal Mode (TTY)

When running `agent` in a terminal:

```json
{
  "type": "status",
  "mode": "interactive-terminal",
  "message": "Agent CLI in interactive terminal mode. Type your message and press Enter.",
  "hint": "Press CTRL+C to exit. Use --help for options.",
  "acceptedFormats": ["JSON object with \"message\" field", "Plain text"],
  "options": {
    "interactive": true,
    "autoMergeQueuedMessages": true,
    "alwaysAcceptStdin": true,
    "compactJson": false
  }
}
```

### Stdin Stream Mode (Piped)

When running with piped input (`echo "hi" | agent`):

```json
{
  "type": "status",
  "mode": "stdin-stream",
  "message": "Agent CLI in continuous listening mode. Accepts JSON and plain text input.",
  "hint": "Press CTRL+C to exit. Use --help for options.",
  "acceptedFormats": ["JSON object with \"message\" field", "Plain text"],
  "options": {
    "interactive": true,
    "autoMergeQueuedMessages": true,
    "alwaysAcceptStdin": true,
    "compactJson": false
  }
}
```

This helps programmatic consumers understand the CLI's current mode.

With `--compact-json`, status messages are output as single-line JSON:

```text
{"type":"status","mode":"stdin-stream","message":"Agent CLI in continuous listening mode. Accepts JSON and plain text input.","hint":"Press CTRL+C to exit. Use --help for options.","acceptedFormats":["JSON object with \"message\" field","Plain text"],"options":{"interactive":true,"autoMergeQueuedMessages":true,"alwaysAcceptStdin":true,"compactJson":true}}
```

## Behavior Matrix

| Scenario                                      | Behavior                                        |
| --------------------------------------------- | ----------------------------------------------- |
| `agent` in terminal (TTY)                     | Interactive terminal mode - accepts typed input |
| `agent --no-always-accept-stdin` in TTY       | Shows help, exits (old behavior)                |
| `echo "hi" \| agent`                          | Continuous mode - waits for more input          |
| `echo '{"message":"hi"}' \| agent`            | Continuous mode - waits for more input          |
| `agent -p "hello"`                            | Processes prompt directly, exits                |
| `agent --disable-stdin`                       | Shows error, suggests -p                        |
| `agent --no-interactive` with plain text      | Rejects, shows error                            |
| `agent --no-interactive` with JSON            | Processes normally                              |
| `agent` with stdin open (non-TTY)             | Outputs status JSON, waits for input            |
| `echo "hi" \| agent --no-always-accept-stdin` | Single-message mode - exits after response      |
| `agent --compact-json`                        | All JSON output is single-line (NDJSON style)   |

## Examples

For a comprehensive interactive terminal mode example with detailed explanations, see [examples/interactive-mode-multi-turn.md](../examples/interactive-mode-multi-turn.md).

For the original unedited terminal output, see [examples/interactive-mode-output.txt](../examples/interactive-mode-output.txt).

### Programmatic Usage

```bash
# Send JSON from a file
cat request.json | agent

# Pipe output from another command
git diff | agent -p "Review these changes"

# Use in scripts
result=$(echo "Summarize: $(cat file.txt)" | agent)
```

### Non-Interactive Mode for Automation

When building automated pipelines, use `--no-interactive` to ensure only valid JSON is accepted:

```bash
#!/bin/bash
# automation-script.sh

json_request='{"message":"Process this data"}'
response=$(echo "$json_request" | agent --no-interactive 2>/dev/null)

if [ $? -eq 0 ]; then
  echo "Success: $response"
else
  echo "Failed to process request"
fi
```

### Interactive Terminal with Prompt

When you want to quickly ask a question without piping:

```bash
agent -p "What is the capital of France?"
```

## Error Handling

### Invalid JSON in Non-Interactive Mode

```json
{
  "type": "error",
  "message": "Invalid JSON input. In non-interactive mode (--no-interactive), only JSON input is accepted.",
  "hint": "Use --interactive to accept plain text, or provide valid JSON: {\"message\": \"your text\"}"
}
```

### No Prompt with --disable-stdin

```json
{
  "type": "error",
  "message": "No prompt provided. Use -p/--prompt to specify a message, or remove --disable-stdin to read from stdin.",
  "hint": "Example: agent -p \"Hello, how are you?\""
}
```

## CLI Best Practices

This implementation follows CLI best practices from:

- [Command Line Interface Guidelines (clig.dev)](https://clig.dev/)
- [12 Factor CLI Apps](https://medium.com/@jdxcode/12-factor-cli-apps-dd3c227a0e46)
- [Node.js CLI Apps Best Practices](https://github.com/lirantal/nodejs-cli-apps-best-practices)

Key principles:

1. **Never hang silently** - Always provide feedback
2. **Detect TTY** - Show help when running interactively without input
3. **Provide alternatives** - `-p` flag for non-piped usage
4. **Be explicit** - Status messages explain the current mode
