# Usage Examples

This document provides practical examples for using each tool with both `@link-assistant/agent` and `opencode` commands.

> ⚠️ **Bun-only** - `@link-assistant/agent` requires [Bun](https://bun.sh) and does NOT support Node.js or Deno.

## Table of Contents

- [Basic Usage](#basic-usage)
- [File Operations](#file-operations)
- [Search Tools](#search-tools)
- [Execution Tools](#execution-tools)
- [Utility Tools](#utility-tools)

## Basic Usage

### Simplest Examples - Start Here!

**Plain text (@link-assistant/agent only, easiest!):**

```bash
echo "hi" | agent
```

**Simple JSON message (both @link-assistant/agent and opencode):**

@link-assistant/agent:

```bash
echo '{"message":"hi"}' | agent
```

opencode:

```bash
echo '{"message":"hi"}' | opencode run --format json --model opencode/grok-code
```

### Plain Text Input (@link-assistant/agent only)

```bash
# Simple message
echo "hello world" | agent

# Ask a question
echo "what is TypeScript?" | agent

# Request web search
echo "search the web for latest React news" | agent
```

### JSON Input Examples

**@link-assistant/agent:**

```bash
echo '{"message":"hello world"}' | agent
```

**opencode:**

```bash
echo '{"message":"hello world"}' | opencode run --format json --model opencode/grok-code
```

## File Operations

### bash Tool

Execute shell commands.

**@link-assistant/agent:**

```bash
echo '{"message":"run command","tools":[{"name":"bash","params":{"command":"echo hello world"}}]}' | agent
```

**opencode:**

```bash
echo '{"message":"run command","tools":[{"name":"bash","params":{"command":"echo hello world"}}]}' | opencode run --format json --model opencode/grok-code
```

**Example with description:**

```bash
echo '{"message":"list files","tools":[{"name":"bash","params":{"command":"ls -la","description":"List all files in current directory"}}]}' | agent
```

### read Tool

Read file contents.

**@link-assistant/agent:**

```bash
echo '{"message":"read file","tools":[{"name":"read","params":{"file_path":"/path/to/file.txt"}}]}' | agent
```

**opencode:**

```bash
echo '{"message":"read file","tools":[{"name":"read","params":{"file_path":"/path/to/file.txt"}}]}' | opencode run --format json --model opencode/grok-code
```

### write Tool

Write content to a file.

**@link-assistant/agent:**

```bash
echo '{"message":"write file","tools":[{"name":"write","params":{"file_path":"/tmp/test.txt","content":"Hello World"}}]}' | agent
```

**opencode:**

```bash
echo '{"message":"write file","tools":[{"name":"write","params":{"file_path":"/tmp/test.txt","content":"Hello World"}}]}' | opencode run --format json --model opencode/grok-code
```

### edit Tool

Edit file with string replacement.

**@link-assistant/agent:**

```bash
echo '{"message":"edit file","tools":[{"name":"edit","params":{"file_path":"/tmp/test.txt","old_string":"Hello","new_string":"Hi"}}]}' | agent
```

**opencode:**

```bash
echo '{"message":"edit file","tools":[{"name":"edit","params":{"file_path":"/tmp/test.txt","old_string":"Hello","new_string":"Hi"}}]}' | opencode run --format json --model opencode/grok-code
```

### list Tool

List directory contents.

**@link-assistant/agent:**

```bash
echo '{"message":"list directory","tools":[{"name":"list","params":{"path":"."}}]}' | agent
```

**opencode:**

```bash
echo '{"message":"list directory","tools":[{"name":"list","params":{"path":"."}}]}' | opencode run --format json --model opencode/grok-code
```

## Search Tools

### glob Tool

Find files using glob patterns.

**@link-assistant/agent:**

```bash
# Find all JavaScript files
echo '{"message":"find js files","tools":[{"name":"glob","params":{"pattern":"**/*.js"}}]}' | agent

# Find TypeScript files in src directory
echo '{"message":"find ts files","tools":[{"name":"glob","params":{"pattern":"src/**/*.ts"}}]}' | agent
```

**opencode:**

```bash
echo '{"message":"find js files","tools":[{"name":"glob","params":{"pattern":"**/*.js"}}]}' | opencode run --format json --model opencode/grok-code
```

### grep Tool

Search text in files with regex.

**@link-assistant/agent:**

```bash
# Search for pattern in files
echo '{"message":"search pattern","tools":[{"name":"grep","params":{"pattern":"function","output_mode":"files_with_matches"}}]}' | agent

# Search with content display
echo '{"message":"search TODO","tools":[{"name":"grep","params":{"pattern":"TODO","output_mode":"content"}}]}' | agent

# Case-insensitive search in JavaScript files
echo '{"message":"search error","tools":[{"name":"grep","params":{"pattern":"error","-i":true,"type":"js","output_mode":"content"}}]}' | agent
```

**opencode:**

```bash
echo '{"message":"search pattern","tools":[{"name":"grep","params":{"pattern":"TODO","output_mode":"content"}}]}' | opencode run --format json --model opencode/grok-code
```

### websearch Tool

Search the web using Exa API.

**@link-assistant/agent (no environment variable needed!):**

```bash
echo '{"message":"search web","tools":[{"name":"websearch","params":{"query":"TypeScript latest features"}}]}' | agent

echo '{"message":"search web","tools":[{"name":"websearch","params":{"query":"React hooks best practices"}}]}' | agent
```

**opencode (requires OPENCODE_EXPERIMENTAL_EXA=true):**

```bash
echo '{"message":"search web","tools":[{"name":"websearch","params":{"query":"TypeScript latest features"}}]}' | opencode run --format json --model opencode/grok-code
```

### codesearch Tool

Search code repositories and documentation.

**@link-assistant/agent (no environment variable needed!):**

```bash
echo '{"message":"search code","tools":[{"name":"codesearch","params":{"query":"React hooks implementation"}}]}' | agent

echo '{"message":"search code","tools":[{"name":"codesearch","params":{"query":"async/await patterns"}}]}' | agent
```

**opencode (requires OPENCODE_EXPERIMENTAL_EXA=true):**

```bash
echo '{"message":"search code","tools":[{"name":"codesearch","params":{"query":"React hooks implementation"}}]}' | opencode run --format json --model opencode/grok-code
```

## Execution Tools

### batch Tool

Batch multiple tool calls together for optimal performance.

**@link-assistant/agent (no configuration needed!):**

```bash
echo '{"message":"run batch","tools":[{"name":"batch","params":{"tool_calls":[{"tool":"bash","parameters":{"command":"echo hello"}},{"tool":"bash","parameters":{"command":"echo world"}}]}}]}' | agent
```

**opencode (requires experimental config):**

```bash
# Create config file first
mkdir -p .link-assistant-agent
echo '{"experimental":{"batch_tool":true}}' > .link-assistant-agent/opencode.json

# Then run
echo '{"message":"run batch","tools":[{"name":"batch","params":{"tool_calls":[{"tool":"bash","parameters":{"command":"echo hello"}},{"tool":"bash","parameters":{"command":"echo world"}}]}}]}' | opencode run --format json --model opencode/grok-code
```

### task Tool

Launch specialized agents for complex tasks.

**@link-assistant/agent:**

```bash
echo '{"message":"launch task","tools":[{"name":"task","params":{"description":"Analyze codebase","prompt":"Find all TODO comments in JavaScript files","subagent_type":"general-purpose"}}]}' | agent
```

**opencode:**

```bash
echo '{"message":"launch task","tools":[{"name":"task","params":{"description":"Analyze codebase","prompt":"Find all TODO comments in JavaScript files","subagent_type":"general-purpose"}}]}' | opencode run --format json --model opencode/grok-code
```

## Utility Tools

### todo Tool

Read and write TODO items for task tracking.

**@link-assistant/agent:**

```bash
# Write todos
echo '{"message":"add todos","tools":[{"name":"todowrite","params":{"todos":[{"content":"Implement feature X","status":"pending","activeForm":"Implementing feature X"},{"content":"Write tests","status":"pending","activeForm":"Writing tests"}]}}]}' | agent

# Read todos
echo '{"message":"read todos","tools":[{"name":"todoread","params":{}}]}' | agent
```

**opencode:**

```bash
echo '{"message":"add todos","tools":[{"name":"todowrite","params":{"todos":[{"content":"Implement feature X","status":"pending","activeForm":"Implementing feature X"}]}}]}' | opencode run --format json --model opencode/grok-code
```

### webfetch Tool

Fetch and process web content.

**@link-assistant/agent:**

```bash
echo '{"message":"fetch url","tools":[{"name":"webfetch","params":{"url":"https://example.com","prompt":"Summarize the content"}}]}' | agent
```

**opencode:**

```bash
echo '{"message":"fetch url","tools":[{"name":"webfetch","params":{"url":"https://example.com","prompt":"Summarize the content"}}]}' | opencode run --format json --model opencode/grok-code
```

## Output Format

### JSON Standards

@link-assistant/agent supports two JSON output format standards via the `--json-standard` option:

#### OpenCode Standard (default)

```bash
# Default - same as --json-standard opencode
echo "hi" | agent

# Explicit opencode standard
echo "hi" | agent --json-standard opencode
```

#### Claude Standard (experimental)

```bash
# Claude CLI compatible format (NDJSON)
echo "hi" | agent --json-standard claude
```

### JSON Event Streaming (Pretty-Printed) - OpenCode Standard

@link-assistant/agent outputs JSON events in pretty-printed streaming format for easy readability, 100% compatible with OpenCode's event structure:

```bash
echo "hi" | agent
```

Output (pretty-printed JSON events):

```json
{
  "type": "step_start",
  "timestamp": 1763618628840,
  "sessionID": "ses_560236487ffe3ROK1ThWvPwTEF",
  "part": {
    "id": "prt_a9fdca4e8001APEs6AriJx67me",
    "type": "step-start",
    ...
  }
}
{
  "type": "text",
  "timestamp": 1763618629886,
  "sessionID": "ses_560236487ffe3ROK1ThWvPwTEF",
  "part": {
    "type": "text",
    "text": "Hi! How can I help with your coding tasks today?",
    ...
  }
}
{
  "type": "step_finish",
  "timestamp": 1763618629916,
  "sessionID": "ses_560236487ffe3ROK1ThWvPwTEF",
  "part": {
    "type": "step-finish",
    "reason": "stop",
    ...
  }
}
```

This format is designed for:

- **Readability**: Pretty-printed JSON is easy to read and debug
- **Streaming**: Events output in real-time as they occur
- **Compatibility**: 100% compatible with OpenCode's event structure
- **Automation**: Can be parsed using standard JSON tools (see filtering examples below)

### Claude Stream-JSON Output (NDJSON)

When using `--json-standard claude`, output is in NDJSON (Newline-Delimited JSON) format, compatible with Claude CLI:

```bash
echo "hi" | agent --json-standard claude
```

Output (compact NDJSON):

```json
{"type":"init","timestamp":"2025-01-01T00:00:00.000Z","session_id":"ses_560236487ffe3ROK1ThWvPwTEF"}
{"type":"message","timestamp":"2025-01-01T00:00:01.000Z","session_id":"ses_560236487ffe3ROK1ThWvPwTEF","role":"assistant","content":[{"type":"text","text":"Hi! How can I help with your coding tasks today?"}]}
{"type":"result","timestamp":"2025-01-01T00:00:01.100Z","session_id":"ses_560236487ffe3ROK1ThWvPwTEF","status":"success","duration_ms":1100}
```

Key differences from OpenCode format:

- **Compact**: One JSON per line (no pretty-printing)
- **Event Types**: `init`, `message`, `tool_use`, `tool_result`, `result`
- **Timestamps**: ISO 8601 strings instead of Unix milliseconds
- **Session ID**: `session_id` (snake_case) instead of `sessionID` (camelCase)
- **Content**: Message content in array format with `{type, text}` objects

### Filtering Output

Extract specific event types using `jq`:

```bash
# Get only text responses
echo '{"message":"hello"}' | agent | jq -r 'select(.type=="text") | .part.text'

# Get tool use events
echo '{"message":"run","tools":[{"name":"bash","params":{"command":"ls"}}]}' | agent | jq 'select(.type=="tool_use")'

# Get bash tool output
echo '{"message":"run","tools":[{"name":"bash","params":{"command":"echo test"}}]}' | agent | jq -r 'select(.type=="tool_use" and .part.tool=="bash") | .part.state.output'

# Pretty print all events
echo "hello" | agent | jq
```

## Tips

### @link-assistant/agent Advantages

1. **No Configuration**: WebSearch, CodeSearch, and Batch tools work without any setup
2. **Plain Text Input**: Can use simple text instead of JSON
3. **Always Enabled**: All tools available by default
4. **Bun-only**: Optimized for Bun runtime (no Node.js/Deno overhead)

### Working with JSON

Use single quotes for the outer shell command and double quotes inside JSON:

```bash
echo '{"message":"test","tools":[{"name":"bash","params":{"command":"echo hello"}}]}' | agent
```

### Debugging

Add `| jq` to prettify JSON output:

```bash
echo "hello" | agent | jq
```

### Chaining Commands

Process output with standard Unix tools:

```bash
# Count events
echo "hello" | agent | wc -l

# Filter and format
echo "hello" | agent | jq -r 'select(.type=="text") | .part.text'
```
