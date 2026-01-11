# @link-assistant/agent

**A minimal, public domain AI CLI agent compatible with OpenCode's JSON interface**

[![npm version](https://badge.fury.io/js/@link-assistant%2Fagent.svg)](https://www.npmjs.com/package/@link-assistant/agent)
[![License: Unlicense](https://img.shields.io/badge/license-Unlicense-blue.svg)](http://unlicense.org/)

> This is the JavaScript/Bun implementation. See also the [Rust implementation](../rust/README.md).

## Requirements

- [Bun](https://bun.sh) >= 1.0.0 (Node.js and Deno are NOT supported)

## Installation

```bash
# Install Bun first if you haven't already
curl -fsSL https://bun.sh/install | bash

# Install the package globally
bun install -g @link-assistant/agent

# Or install locally in your project
bun add @link-assistant/agent
```

After installation, the `agent` command will be available globally.

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

## CLI Options

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

Stdin Mode Options:
  -p, --prompt                   Direct prompt (bypasses stdin reading)
  --disable-stdin                Disable stdin streaming (requires --prompt)
  --stdin-stream-timeout         Timeout in ms for stdin reading (default: none)
  --interactive                  Accept plain text input (default: true)
  --no-interactive               Only accept JSON input
  --auto-merge-queued-messages   Merge rapidly arriving lines (default: true)
  --no-auto-merge-queued-messages Treat each line as separate message
  --always-accept-stdin          Keep accepting input after agent finishes (default: true)
  --no-always-accept-stdin       Single-message mode - exit after first response
  --compact-json                 Output compact JSON for program-to-program use

Session Resume Options:
  -r, --resume <sessionID>       Resume a specific session by ID
                                 By default, forks with a new UUID
  -c, --continue                 Continue the most recent session
                                 By default, forks with a new UUID
  --no-fork                      When used with --resume or --continue,
                                 continue in the same session without forking

  --help                         Show help
  --version                      Show version number

Commands:
  auth login           Authenticate with a provider (Anthropic, GitHub Copilot, etc.)
  auth logout          Remove credentials for a provider
  auth list            List configured credentials
  auth status          Check authentication status (experimental)
  mcp                  MCP server commands
```

## Development

### Running in Development Mode

```bash
bun run dev
```

Or run directly:

```bash
bun run src/index.js
```

### Testing

```bash
# Run all tests
bun test

# Run specific test file
bun test tests/mcp.test.js
bun test tests/websearch.tools.test.js
bun test tests/batch.tools.test.js
bun test tests/plaintext.input.test.js
```

### Linting and Formatting

```bash
# Run linting
bun run lint

# Fix linting issues
bun run lint:fix

# Format code
bun run format

# Check formatting
bun run format:check
```

### Publishing

The package uses [Changesets](https://github.com/changesets/changesets) for version management:

1. Create a changeset:

   ```bash
   bun run changeset
   ```

2. Version the package:

   ```bash
   bun run changeset:version
   ```

3. Publish to npm:
   ```bash
   bun run changeset:publish
   ```

## Project Structure

```
js/
├── src/           # Source code
│   ├── index.js   # Main entry point
│   ├── session/   # Session management
│   └── tool/      # Tool implementations
├── tests/         # Test files
├── experiments/   # Experimental code
├── package.json   # Package configuration
└── tsconfig.json  # TypeScript configuration
```

## Why Bun-only?

This agent is **exclusively built for Bun** for the following reasons:

1. **Faster Development**: No compilation step - direct execution with `bun run`
2. **Simpler Dependencies**: Fewer dev dependencies, no TypeScript compiler overhead
3. **Performance**: Bun's fast runtime and native ESM support
4. **Minimalism**: Single runtime target keeps the codebase simple
5. **Bun Ecosystem**: Leverages Bun-specific features and optimizations

**Not supporting Node.js or Deno is intentional** to keep the project focused and minimal.

## Documentation

For full documentation, see the [main README](../README.md) in the repository root.

- [Models and Pricing](../MODELS.md)
- [Tools Reference](../TOOLS.md)
- [Usage Examples](../EXAMPLES.md)
- [Testing Guide](../TESTING.md)

## License

Unlicense (Public Domain)
