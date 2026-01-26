# Interactive Mode: Multi-Turn Conversation Example

This example demonstrates how the Agent CLI works in interactive terminal mode with multiple sequential inputs, showing a complete multi-turn conversation session.

## Overview

When you run `agent` in an interactive terminal (TTY), it enters **interactive terminal mode** where you can have ongoing conversations with the AI agent without restarting the process. This mode:

- Maintains session context across multiple messages
- Accepts both JSON and plain text input
- Streams responses as JSON events
- Continues listening until you exit (Ctrl+C or EOF)

## Running the Example

Simply run the agent in your terminal:

```bash
agent
```

## Complete Example Session

Below is a real example of running `agent` in interactive terminal mode and having a multi-turn conversation.

**📄 Want to see the raw, unedited output?** Check out [interactive-mode-output.txt](./interactive-mode-output.txt) for the complete original terminal output without any modifications or explanations.

### Initial Status Message

When you start the agent, it outputs a status message showing the mode and configuration:

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

### First Message: "hi"

**User types:**

```
hi
```

**Agent responds with streaming JSON events:**

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

### Second Message: "who are you?"

**User types:**

```
who are you?
```

**Agent responds with streaming JSON events:**

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

## Key Features Explained

### 1. Continuous Listening

The agent doesn't exit after the first response. It continues to accept input, allowing for a natural conversation flow.

### 2. Session Persistence

Notice the `sessionID` field remains constant across both messages:

- First message: `"sessionID": "ses_4bfa26db0ffeRkIzLa0XHXrOFX"`
- Second message: `"sessionID": "ses_4bfa26db0ffeRkIzLa0XHXrOFX"`

This indicates the agent maintains conversation context across all messages in the session.

### 3. Plain Text Input Auto-Conversion

Both user inputs (`hi` and `who are you?`) are plain text. The agent automatically converts them to JSON messages internally, so you don't need to manually format JSON.

### 4. Streaming JSON Events

Each agent response consists of three event types:

1. **step_start** - Indicates the agent has started processing your message
2. **text** - Contains the actual response text (can be multiple events if response is long)
3. **step_finish** - Indicates completion with metadata including:
   - `reason`: Why the step finished (e.g., "stop")
   - `cost`: API cost (if applicable)
   - `tokens`: Detailed token usage breakdown
     - `input`: Tokens in the request
     - `output`: Tokens in the response
     - `reasoning`: Tokens used for internal reasoning
     - `cache.read`: Tokens read from cache
     - `cache.write`: Tokens written to cache

### 5. Token Usage Tracking

Each response includes detailed token metrics:

**First message:**

- Input: 8,515 tokens
- Output: 9 tokens
- Reasoning: 125 tokens
- Cache read: 192 tokens

**Second message:**

- Input: 23 tokens (much smaller due to caching)
- Output: 80 tokens
- Reasoning: 70 tokens
- Cache read: 8,832 tokens (reusing context from first message)

Notice how the second message has a much smaller input count but larger cache read - this shows the agent is efficiently reusing the conversation context from cache.

## Exiting Interactive Mode

To exit the agent, you can:

- Press `CTRL+C` to interrupt the process
- Send EOF (Ctrl+D on Unix/Linux/macOS, Ctrl+Z on Windows)
- Close your terminal window

## Additional Options

You can customize the interactive mode behavior with various flags:

```bash
# Output compact JSON (single-line NDJSON format)
agent --compact-json

# Disable auto-merging of multi-line input
agent --no-auto-merge-queued-messages

# Exit after first message (single-message mode)
agent --no-always-accept-stdin
```

See the [stdin-mode documentation](../docs/stdin-mode.md) for complete details on all available options.

## Use Cases

Interactive terminal mode is ideal for:

- **Quick Q&A sessions**: Ask multiple questions without restarting
- **Code assistance**: Iterative code review and improvement
- **Debugging**: Multi-step problem solving with context retention
- **Learning**: Exploratory conversations about topics
- **Prototyping**: Testing agent behavior interactively

## Related Documentation

- [Stdin Mode Documentation](../docs/stdin-mode.md) - Complete guide to stdin handling
- [stdin-mode-examples.sh](./stdin-mode-examples.sh) - Shell script examples for various stdin modes
