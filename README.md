# Link Assistant Agent

**A minimal, public domain AI CLI agent compatible with OpenCode's JSON interface**

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

## Implementations

This repository contains two implementations of the agent:

| Implementation | Status | Package Manager | Install Command |
|---------------|--------|-----------------|-----------------|
| [JavaScript/Bun](js/README.md) | **Production Ready** | npm | `bun install -g @link-assistant/agent` |
| [Rust](rust/README.md) | Work in Progress | cargo | `cargo install agent` (when published) |

Both implementations aim to be fully compatible with [OpenCode](https://github.com/sst/opencode)'s `run --format json` mode.

### JavaScript/Bun Implementation

[![npm version](https://badge.fury.io/js/@link-assistant%2Fagent.svg)](https://www.npmjs.com/package/@link-assistant/agent)

The primary implementation, feature-complete and production-ready. Requires [Bun](https://bun.sh) >= 1.0.0.

```bash
# Install
bun install -g @link-assistant/agent

# Usage
echo "hi" | agent
```

See [js/README.md](js/README.md) for full documentation including:
- Complete CLI options reference
- Model selection examples
- Session resume functionality
- MCP (Model Context Protocol) configuration
- JSON output standards (OpenCode and Claude formats)

### Rust Implementation

The Rust implementation provides core functionality but is still under active development.

```bash
# Build from source
cd rust
cargo build --release
./target/release/agent -p "hello"
```

See [rust/README.md](rust/README.md) for full documentation.

## Project Vision

We're creating a slimmed-down, public domain version of OpenCode CLI focused on the "agentic run mode" for use in virtual machines, Docker containers, and other environments where unrestricted AI agent access is acceptable. This is **not** for general desktop use - it's for isolated environments where you want maximum AI agent freedom.

**OpenCode Compatibility**: We maintain 100% compatibility with OpenCode's JSON event streaming format, so tools expecting `opencode run --format json --model opencode/grok-code` output will work with our agent-cli.

## Features

- **JSON Input/Output**: Accepts JSON via stdin, outputs JSON event streams (OpenCode-compatible)
- **Plain Text Input**: Also accepts plain text messages (auto-converted to JSON format)
- **Unrestricted Access**: Full file system and command execution access (no sandbox, no restrictions)
- **Tool Support**: 13 tools including websearch, codesearch, batch - all enabled by default
- **Flexible Model Selection**: Supports [OpenCode Zen](https://opencode.ai/docs/zen/), [Claude OAuth](docs/claude-oauth.md), [Groq](docs/groq.md), and more - see [MODELS.md](MODELS.md)
- **Public Domain**: Unlicense - use it however you want

## Quick Start

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

**Direct prompt mode:**

```bash
agent -p "What is 2+2?"
```

See [js/README.md](js/README.md#usage) for more usage examples including model selection, session resume, and JSON output standards.

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

## Architecture

This agent reproduces OpenCode's `run --format json` command architecture:

- **Streaming JSON Events**: Real-time event stream output
- **Event Types**: `tool_use`, `text`, `step_start`, `step_finish`, `error`
- **Session Management**: Unique session IDs for each request
- **Tool Execution**: Tools with unrestricted access
- **Compatible Format**: Events match OpenCode's JSON schema exactly

## MCP (Model Context Protocol) Support

The agent supports the Model Context Protocol (MCP), allowing you to extend functionality with MCP servers such as browser automation via Playwright.

**Quick setup for Playwright MCP:**

```bash
agent mcp add playwright npx @playwright/mcp@latest
```

See [js/README.md](js/README.md#mcp-model-context-protocol-support) for full MCP documentation including:
- Available Playwright tools (22+ browser automation capabilities)
- MCP server configuration
- Usage examples

## Documentation

| Document | Description |
|----------|-------------|
| [MODELS.md](MODELS.md) | Available models, providers, and pricing |
| [TOOLS.md](TOOLS.md) | Complete tool documentation |
| [EXAMPLES.md](EXAMPLES.md) | Usage examples for each tool |
| [TESTING.md](TESTING.md) | Testing guide |
| [js/README.md](js/README.md) | JavaScript/Bun implementation (full docs) |
| [rust/README.md](rust/README.md) | Rust implementation |

## Files

### JavaScript Implementation (js/)

- `js/src/index.js` - Main entry point with JSON/plain text input support
- `js/src/session/` - Session management and agent implementation
- `js/src/tool/` - Tool implementations
- `js/tests/` - Comprehensive test suite
- `js/package.json` - npm package configuration

### Rust Implementation (rust/)

- `rust/src/main.rs` - Main entry point
- `rust/src/cli.rs` - CLI argument parsing
- `rust/src/tool/` - Tool implementations
- `rust/Cargo.toml` - Cargo package configuration

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
