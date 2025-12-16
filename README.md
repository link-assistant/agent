# @link-assistant/agent

**A minimal, public domain AI CLI agent compatible with OpenCode's JSON interface**

[![npm version](https://badge.fury.io/js/@link-assistant%2Fagent.svg)](https://www.npmjs.com/package/@link-assistant/agent)
[![License: Unlicense](https://img.shields.io/badge/license-Unlicense-blue.svg)](http://unlicense.org/)

> 🚨 **SECURITY WARNING: 100% UNSAFE AND AUTONOMOUS** 🚨
>
> This agent operates with **ZERO RESTRICTIONS** and **FULL AUTONOMY**:
>
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
- ✅ **Flexible Model Selection**: Defaults to free OpenCode Zen Grok Code Fast 1, supports [OpenCode Zen](https://opencode.ai/docs/zen/), [Claude OAuth](docs/claude-oauth.md), and [Groq](docs/groq.md) providers
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
- **Flexible Model Selection**: Defaults to free Grok Code Fast 1, supports [OpenCode Zen](https://opencode.ai/docs/zen/), [Claude OAuth](docs/claude-oauth.md), and [Groq](docs/groq.md) - see [MODELS.md](MODELS.md)
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
bun install -g @link-assistant/agent

# Or install locally in your project
bun add @link-assistant/agent
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

# Groq models (requires GROQ_API_KEY)
echo "hi" | agent --model groq/llama-3.3-70b-versatile  # Llama 3.3 70B
echo "hi" | agent --model groq/llama-3.1-8b-instant     # Llama 3.1 8B (fast)

# Anthropic direct (requires ANTHROPIC_API_KEY)
echo "hi" | agent --model anthropic/claude-sonnet-4-5  # Claude Sonnet 4.5
echo "hi" | agent --model anthropic/claude-opus-4-1    # Claude Opus 4.1

# Anthropic OAuth (requires Claude Pro/Max subscription)
agent auth login                                       # Select Anthropic > Claude Pro/Max
echo "hi" | agent --model anthropic/claude-sonnet-4-5  # Uses OAuth credentials

# Use existing Claude Code CLI credentials
echo "hi" | agent --use-existing-claude-oauth          # Reads from ~/.claude/.credentials.json

# GitHub Copilot (requires Copilot subscription)
agent auth login                                       # Select GitHub Copilot
echo "hi" | agent --model github-copilot/gpt-4o        # Uses Copilot
```

See [MODELS.md](MODELS.md) for complete list of available models and pricing.
See [docs/groq.md](docs/groq.md) for Groq provider documentation.
See [docs/claude-oauth.md](docs/claude-oauth.md) for Claude OAuth provider documentation.

### CLI Options

```bash
agent [options]

Options:
  --model                        Model to use in format providerID/modelID
                                 Default: opencode/grok-code
  --json-standard                JSON output format standard
                                 Choices: "opencode" (default), "claude" (experimental)
  --use-existing-claude-oauth    Use existing Claude OAuth credentials
                                 from ~/.claude/.credentials.json
  --system-message               Full override of the system message
  --system-message-file          Full override of the system message from file
  --append-system-message        Append to the default system message
  --append-system-message-file   Append to the default system message from file
  --help                         Show help
  --version                      Show version number

Commands:
  auth login           Authenticate with a provider (Anthropic, GitHub Copilot, etc.)
  auth logout          Remove credentials for a provider
  auth list            List configured credentials
  auth status          Check authentication status (experimental)
  mcp                  MCP server commands
```

### JSON Output Standards

The agent supports two JSON output format standards via the `--json-standard` option:

#### OpenCode Standard (default)

The OpenCode format is the default JSON output format, compatible with `opencode run --format json`:

```bash
echo "hi" | agent --json-standard opencode
```

- **Format**: Pretty-printed JSON (human-readable with indentation)
- **Event Types**: `step_start`, `step_finish`, `text`, `tool_use`, `error`
- **Timestamps**: Unix milliseconds (number)
- **Session ID**: `sessionID` (camelCase)

#### Claude Standard (experimental)

The Claude format provides compatibility with Anthropic's Claude CLI `--output-format stream-json`:

```bash
echo "hi" | agent --json-standard claude
```

- **Format**: NDJSON (Newline-Delimited JSON - compact, one JSON per line)
- **Event Types**: `init`, `message`, `tool_use`, `tool_result`, `result`
- **Timestamps**: ISO 8601 strings
- **Session ID**: `session_id` (snake_case)

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

## MCP (Model Context Protocol) Support

The agent supports the Model Context Protocol (MCP), allowing you to extend functionality with MCP servers. MCP enables the agent to interact with external tools and services, such as browser automation via Playwright.

### Installing Playwright MCP

Microsoft's Playwright MCP server provides browser automation capabilities using Playwright. This enables the agent to interact with web pages through structured accessibility snapshots.

**Requirements:**

- Node.js 18 or newer (for running the Playwright MCP server)
- Bun (for running the agent itself)

**Installation:**

```bash
# Add Playwright MCP server to your agent configuration
agent mcp add playwright npx @playwright/mcp@latest

# Verify the configuration
agent mcp list
```

This will create a configuration file at `~/.config/opencode/opencode.json` (or your system's config directory) with:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["npx", "@playwright/mcp@latest"],
      "enabled": true
    }
  }
}
```

**Available Playwright Tools:**

Once configured, the agent gains access to 22+ browser automation tools:

- `browser_navigate` - Navigate to a URL
- `browser_click` - Click on an element
- `browser_type` - Type text into an element
- `browser_snapshot` - Capture accessibility snapshot
- `browser_take_screenshot` - Take a screenshot
- `browser_fill_form` - Fill multiple form fields
- `browser_select_option` - Select dropdown option
- `browser_hover` - Hover over element
- `browser_drag` - Drag and drop
- `browser_evaluate` - Execute JavaScript
- `browser_tabs` - Manage browser tabs
- `browser_close` - Close the browser
- `browser_wait_for` - Wait for text/element
- `browser_press_key` - Press keyboard key
- `browser_handle_dialog` - Handle browser dialogs
- `browser_network_requests` - Get network requests
- `browser_console_messages` - Get console messages
- `browser_file_upload` - Upload files
- `browser_resize` - Resize browser window
- `browser_navigate_back` - Navigate back
- `browser_install` - Install browser
- `browser_run_code` - Run Playwright code

**Usage Example:**

```bash
# Tell the agent to navigate to a website and take a screenshot
echo "Navigate to https://example.com and take a screenshot" | agent
```

The agent will automatically use the Playwright MCP tools when browser automation is needed.

**Learn More:**

- [Playwright MCP GitHub Repository](https://github.com/microsoft/playwright-mcp)
- [Using Playwright MCP with Claude Code](https://til.simonwillison.net/claude-code/playwright-mcp-claude-code)
- [Playwright MCP Case Study](docs/case-studies/playwright-mcp-support/case-study.md)

### Managing MCP Servers

**List configured servers:**

```bash
agent mcp list
```

**Add a remote MCP server:**

```bash
agent mcp add myserver --url https://example.com/mcp
```

**Interactive mode:**

If you prefer an interactive setup, just run:

```bash
agent mcp add
```

The interactive prompt will guide you through configuring local or remote MCP servers.

## Examples

See [EXAMPLES.md](EXAMPLES.md) for detailed usage examples of each tool with both agent-cli and opencode commands.

## Testing

```bash
# Run all tests
bun test

# Run specific test file
bun test tests/mcp.test.js
bun test tests/websearch.tools.test.js
bun test tests/batch.tools.test.js
bun test tests/plaintext.input.test.js
```

For detailed testing information including how to run tests manually and trigger CI tests, see [TESTING.md](TESTING.md).

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
- ✅ JSON standard unit tests (opencode and claude formats)
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

## Reference Implementations

This repository includes official reference implementations as git submodules to provide best-in-class examples:

- **original-opencode** - [OpenCode](https://github.com/sst/opencode) - The original OpenCode implementation we maintain compatibility with
- **reference-gemini-cookbook** - [Google Gemini Cookbook](https://github.com/google-gemini/cookbook) - Official examples and guides for using the Gemini API
- **reference-gemini-cli** - [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) - Official AI agent bringing Gemini directly to the terminal
- **reference-qwen3-coder** - [Qwen3-Coder](https://github.com/QwenLM/Qwen3-Coder) - Official Qwen3 code model from Alibaba Cloud

To initialize all submodules:

```bash
git submodule update --init --recursive
```

These reference implementations provide valuable insights into different approaches for building AI agents and can serve as learning resources for developers working with this codebase.

## License

Unlicense (Public Domain)
