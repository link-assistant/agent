# agent (Rust)

**A minimal, public domain AI CLI agent compatible with OpenCode's JSON interface**

[![Crates.io](https://img.shields.io/crates/v/agent.svg)](https://crates.io/crates/agent)
[![License: Unlicense](https://img.shields.io/badge/license-Unlicense-blue.svg)](http://unlicense.org/)

> This is the Rust implementation. See also the [JavaScript/Bun implementation](../js/README.md).

## Status

**Work in Progress** - The Rust implementation provides core functionality but is still under active development. For production use, consider the [JavaScript/Bun version](../js/README.md) which has full feature parity with OpenCode.

### Implemented Features

- JSON Input/Output compatible with OpenCode format
- Plain text input support (auto-converted to JSON)
- Core CLI argument parsing
- Session and message ID generation
- Tool framework with 7 implemented tools:
  - `bash` - Execute shell commands
  - `read` - Read file contents
  - `write` - Write files
  - `edit` - Edit files with string replacement
  - `list` - List directory contents
  - `glob` - File pattern matching
  - `grep` - Text search with regex support

### Not Yet Implemented

- LLM API integration (currently echoes input)
- WebSearch and CodeSearch tools
- Batch tool
- Task tool (subagent support)
- Todo tool
- WebFetch tool
- MCP (Model Context Protocol) support
- Session resume/continue functionality
- Authentication system

## Requirements

- Rust 1.70 or newer
- Cargo (Rust's package manager)

## Installation

### From Source

```bash
cd rust
cargo build --release

# The binary will be at target/release/agent
./target/release/agent --help
```

### From crates.io (when published)

```bash
cargo install agent
```

## Quick Start

**Plain text input:**

```bash
echo "hi" | ./target/release/agent
```

**JSON input:**

```bash
echo '{"message":"hi"}' | ./target/release/agent
```

**Direct prompt:**

```bash
./target/release/agent -p "hello world"
```

**Dry run mode (no API calls):**

```bash
./target/release/agent --dry-run -p "test"
```

## CLI Options

```bash
agent [OPTIONS]

Options:
      --model <MODEL>                    Model to use in format providerID/modelID
                                         [default: opencode/gpt-5-nano]
      --json-standard <JSON_STANDARD>    JSON output format standard
                                         [possible values: opencode, claude]
                                         [default: opencode]
  -p, --prompt <PROMPT>                  Direct prompt (bypasses stdin reading)
      --system-message <SYSTEM_MESSAGE>  System message override
      --append-system-message <MSG>      Append to system message
      --verbose                          Enable verbose mode
      --dry-run                          Dry run mode (simulate without API calls)
      --compact-json                     Output compact JSON (single line)
      --working-directory <PATH>         Working directory
  -h, --help                             Print help
  -V, --version                          Print version
```

## Development

### Building

```bash
cargo build
```

### Running Tests

```bash
cargo test
```

### Running with Logging

```bash
RUST_LOG=debug cargo run -- -p "hello"
```

## Project Structure

```
rust/
├── src/
│   ├── main.rs      # Entry point
│   ├── cli.rs       # CLI argument parsing
│   ├── error.rs     # Error handling
│   ├── id.rs        # ID generation (session, message, part IDs)
│   ├── util/        # Utility modules
│   └── tool/        # Tool implementations
│       ├── mod.rs   # Tool registry
│       ├── context.rs
│       ├── bash.rs
│       ├── read.rs
│       ├── write.rs
│       ├── edit.rs
│       ├── list.rs
│       ├── glob.rs
│       └── grep.rs
├── changelog.d/     # Changelog fragments
├── Cargo.toml       # Package configuration
└── Cargo.lock       # Dependency lock file
```

## JSON Output Format

The Rust implementation outputs OpenCode-compatible JSON events:

```json
{
  "type": "step_start",
  "timestamp": 1763618628840,
  "sessionID": "ses_560236487ffe3ROK1ThWvPwTEF"
}
{
  "type": "text",
  "timestamp": 1763618629886,
  "sessionID": "ses_560236487ffe3ROK1ThWvPwTEF",
  "text": "Agent (Rust) ready. 7 tools available."
}
{
  "type": "step_finish",
  "timestamp": 1763618629916,
  "sessionID": "ses_560236487ffe3ROK1ThWvPwTEF",
  "reason": "stop"
}
```

## Documentation

For full documentation, see the [main README](../README.md) in the repository root.

- [Models and Pricing](../MODELS.md)
- [Tools Reference](../TOOLS.md)
- [Usage Examples](../EXAMPLES.md)

## License

Unlicense (Public Domain)
