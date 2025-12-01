# @deep-assistant/agent

**A minimal, public domain AI CLI agent compatible with OpenCode's JSON interface**

[![npm version](https://badge.fury.io/js/@deep-assistant%2Fagent.svg)](https://www.npmjs.com/package/@deep-assistant/agent)
[![License: Unlicense](https://img.shields.io/badge/license-Unlicense-blue.svg)](http://unlicense.org/)

> 🚨 **SECURITY WARNING: 100% UNSAFE AND AUTONOMOUS** 🚨
>
> This agent operates with **ZERO RESTRICTIONS** and **FULL AUTONOMY**:
> - ❌ **No Sandbox** - Complete unrestricted file system access
> - ❌ **No Permissions System** - No approval required for any actions
> - ❌ **No Safety Guardrails** - Can execute ANY command with full privileges
> - ⚠️ **Autonomous Execution** - Makes decisions and executes actions independently
>
> **ONLY use in isolated environments** (VMs, Docker containers) where AI agents can have unrestricted access. **NOT SAFE** for personal computers, production servers, or systems with sensitive data.

> ⚠️ **Bun-only runtime** - This package requires [Bun](https://bun.sh) and does NOT support Node.js or Deno.

This is an MVP implementation of an OpenCode-compatible CLI agent, focused on maximum efficiency and unrestricted execution. We reproduce OpenCode's `run --format json --model opencode/grok-code` mode with:

- ✅ **JSON Input/Output**: Compatible with `opencode run --format json --model opencode/grok-code`
- ✅ **Plain Text Input**: Also accepts plain text messages (auto-converted to JSON format)
- ✅ **Flexible Model Selection**: Defaults to free OpenCode Zen Grok Code Fast 1, supports all [OpenCode Zen models](https://opencode.ai/docs/zen/)
- ✅ **No Restrictions**: Fully unrestricted file system and command execution access (no sandbox)
- ✅ **Minimal Footprint**: Built with Bun.sh for maximum efficiency
- ✅ **Full Tool Support**: 13 tools including websearch, codesearch, batch - all enabled by default
- ✅ **100% OpenCode Compatible**: All tool outputs match OpenCode's JSON format exactly
- ✅ **Internal HTTP Server**: Uses local HTTP server for session management (not exposed externally)
- ❌ **No TUI**: Pure JSON CLI interface only
- ❌ **No Sandbox**: Designed for VMs/containers where full access is acceptable
- ❌ **No LSP**: No Language Server Protocol support for diagnostics
- ❌ **No Permissions**: No permission system - full unrestricted access
- ❌ **No IDE Integration**: No IDE/editor integration features
- ❌ **No Plugins**: No plugin system
- ❌ **No Share**: No session sharing functionality
- ❌ **No External API**: Server runs only internally, not exposed to network
- ❌ **No ACP**: No Agent Client Protocol support

## Project Vision

We're creating a slimmed-down, public domain version of OpenCode CLI focused on the "agentic run mode" for use in virtual machines, Docker containers, and other environments where unrestricted AI agent access is acceptable. This is **not** for general desktop use - it's for isolated environments where you want maximum AI agent freedom.

**OpenCode Compatibility**: We maintain 100% compatibility with OpenCode's JSON event streaming format, so tools expecting `opencode run --format json --model opencode/grok-code` output will work with our agent-cli.

## Design Choices

### Why Bun-only? No Node.js or Deno support?

This agent is **exclusively built for Bun** for the following reasons:

1. **Faster Development**: No compilation step - direct execution with `bun run`
2. **Simpler Dependencies**: Fewer dev dependencies, no TypeScript compiler overhead
3. **Performance**: Bun's fast runtime and native ESM support
4. **Minimalism**: Single runtime target keeps the codebase simple
5. **Bun Ecosystem**: Leverages Bun-specific features and optimizations

**Not supporting Node.js or Deno is intentional** to keep the project focused and minimal. If you need Node.js/Deno compatibility, consider using [OpenCode](https://github.com/sst/opencode) instead.

### Architecture: Reproducing OpenCode's JSON Event Streaming

This agent-cli reproduces the core architecture of [OpenCode](https://github.com/sst/opencode)'s `run --format json` command:

- **Streaming JSON Events**: Instead of single responses, outputs real-time event stream
- **Event Types**: `tool_use`, `text`, `step_start`, `step_finish`, `error`
- **Session Management**: Each request gets a unique session ID
- **Tool Execution**: 13 tools with unrestricted access (bash, read, write, edit, list, glob, grep, websearch, codesearch, batch, task, todo, webfetch)
- **Compatible Format**: Events match OpenCode's JSON schema for interoperability

The agent streams events as they occur, providing the same real-time experience as OpenCode's JSON mode.

## Features

- **JSON Input/Output**: Accepts JSON via stdin, outputs JSON event streams (OpenCode-compatible)
- **Plain Text Input**: Also accepts plain text messages (auto-converted to JSON format)
- **Unrestricted Access**: Full file system and command execution access (no sandbox, no restrictions)
- **Tool Support**: 13 tools including websearch, codesearch, batch - all enabled by default
- **Flexible Model Selection**: Defaults to free Grok Code Fast 1, supports all [OpenCode Zen models](https://opencode.ai/docs/zen/) - see [MODELS.md](MODELS.md)
- **Bun.sh First**: Built with Bun for maximum efficiency and minimal resource usage
- **No TUI**: Pure JSON CLI interface for automation and integration
- **Public Domain**: Unlicense - use it however you want

## Installation

**Requirements:**
- [Bun](https://bun.sh) >= 1.0.0 (Node.js and Deno are NOT supported)

```bash
# Install Bun first if you haven't already
curl -fsSL https://bun.sh/install | bash

# Install the package globally
bun install -g @deep-assistant/agent

# Or install locally in your project
bun add @deep-assistant/agent
```

After installation, the `agent` command will be available globally.

## Usage

### Simplest Examples

**Plain text (easiest):**
```bash
echo "hi" | agent
```

**Simple JSON message:**
```bash
echo '{"message":"hi"}' | agent
```

**With custom model:**
```bash
echo "hi" | agent --model opencode/grok-code
```

### More Examples

**Plain Text Input:**
```bash
echo "hello world" | agent
echo "search the web for TypeScript news" | agent
```

**JSON Input with tool calls:**
```bash
echo '{"message":"run command","tools":[{"name":"bash","params":{"command":"ls -la"}}]}' | agent
```

**Using different models:**
```bash
# Default model (free Grok Code Fast 1)
echo "hi" | agent

# Other free models
echo "hi" | agent --model opencode/big-pickle
echo "hi" | agent --model opencode/gpt-5-nano

# Premium models (OpenCode Zen subscription)
echo "hi" | agent --model opencode/sonnet        # Claude Sonnet 4.5
echo "hi" | agent --model opencode/haiku         # Claude Haiku 4.5
echo "hi" | agent --model opencode/opus          # Claude Opus 4.1
echo "hi" | agent --model opencode/gemini-3-pro  # Gemini 3 Pro
```

See [MODELS.md](MODELS.md) for complete list of available models and pricing.

### CLI Options

```bash
agent [options]

Options:
  --model                        Model to use in format providerID/modelID
                                 Default: opencode/grok-code
  --system-message               Full override of the system message
  --system-message-file          Full override of the system message from file
  --append-system-message        Append to the default system message
  --append-system-message-file   Append to the default system message from file
  --help                         Show help
  --version                      Show version number
```

### Input Formats

**Plain Text (auto-converted):**
```bash
echo "your message here" | agent
```

**JSON Format:**
```json
{
  "message": "Your message here",
  "tools": [
    {
      "name": "bash",
      "params": { "command": "ls -la" }
    }
  ]
}
```

## Supported Tools

All 13 tools are **enabled by default** with **no configuration required**. See [TOOLS.md](TOOLS.md) for complete documentation.

### File Operations
- **`read`** - Read file contents
- **`write`** - Write files
- **`edit`** - Edit files with string replacement
- **`list`** - List directory contents

### Search Tools
- **`glob`** - File pattern matching (`**/*.js`)
- **`grep`** - Text search with regex support
- **`websearch`** ✨ - Web search via Exa API (no config needed!)
- **`codesearch`** ✨ - Code search via Exa API (no config needed!)

### Execution Tools
- **`bash`** - Execute shell commands
- **`batch`** ✨ - Batch multiple tool calls (no config needed!)
- **`task`** - Launch subagent tasks

### Utility Tools
- **`todo`** - Task tracking
- **`webfetch`** - Fetch and process URLs

✨ = Always enabled (no experimental flags or environment variables needed)

## Examples

See [EXAMPLES.md](EXAMPLES.md) for detailed usage examples of each tool with both agent-cli and opencode commands.

## Testing

```bash
# Run all tests
bun test

# Run specific test file
bun test tests/websearch.tools.test.js
bun test tests/batch.tools.test.js
bun test tests/plaintext.input.test.js
```

## Maintenance

### Development

Run the agent in development mode:
```bash
bun run dev
```

Or run directly:
```bash
bun run src/index.js
```

### Testing

Simply run:
```bash
bun test
```

Bun automatically discovers and runs all `*.test.js` files in the project.

### Test Coverage

- ✅ 13 tool implementation tests
- ✅ Plain text input support test
- ✅ OpenCode compatibility tests for websearch/codesearch
- ✅ All tests pass with 100% OpenCode JSON format compatibility

### Publishing

To publish a new version to npm:

1. **Update version** in `package.json`:
   ```bash
   # Update version field manually (e.g., 0.0.3 -> 0.0.4)
   ```

2. **Commit changes**:
   ```bash
   git add .
   git commit -m "Release v0.0.4"
   git push
   ```

3. **Publish to npm**:
   ```bash
   npm publish
   ```

The package publishes source files directly (no build step required). Bun handles TypeScript execution natively.

## Key Features

### No Configuration Required
- **WebSearch/CodeSearch**: Work without `OPENCODE_EXPERIMENTAL_EXA` environment variable
- **Batch Tool**: Always enabled, no experimental flag needed
- **All Tools**: No config files, API keys handled automatically

### OpenCode 100% Compatible
- All tools produce JSON output matching OpenCode's exact format
- WebSearch and CodeSearch tools are verified 100% compatible
- Tool event structure matches OpenCode specifications
- Can be used as drop-in replacement for `opencode run --format json`

### Plain Text Support
Both plain text and JSON input work:
```bash
# Plain text
echo "hello" | bun run src/index.js

# JSON
echo '{"message":"hello"}' | bun run src/index.js
```

Plain text is automatically converted to `{"message":"your text"}` format.

### JSON Event Streaming Output
JSON output is pretty-printed for easy readability while maintaining OpenCode compatibility:
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
    "id": "prt_a9fdca85c001bVEimWb9L3ya6T",
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
    "id": "prt_a9fdca8ff0015cBrNxckAXI3aE",
    "type": "step-finish",
    "reason": "stop",
    ...
  }
}
```

## Architecture

This agent-cli reproduces OpenCode's `run --format json` command architecture:

- **Streaming JSON Events**: Real-time event stream output
- **Event Types**: `tool_use`, `text`, `step_start`, `step_finish`, `error`
- **Session Management**: Unique session IDs for each request
- **Tool Execution**: 13 tools with unrestricted access
- **Compatible Format**: Events match OpenCode's JSON schema exactly

## Files

- `src/index.js` - Main entry point with JSON/plain text input support
- `src/session/agent.js` - Agent implementation
- `src/tool/` - Tool implementations
- `tests/` - Comprehensive test suite
- [MODELS.md](MODELS.md) - Available models and pricing
- [TOOLS.md](TOOLS.md) - Complete tool documentation
- [EXAMPLES.md](EXAMPLES.md) - Usage examples for each tool

## License

Unlicense (Public Domain)
