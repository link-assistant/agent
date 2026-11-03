# link-assistant-agent (Rust)

**A minimal, public domain AI CLI agent compatible with OpenCode's JSON interface**

[![Crates.io](https://img.shields.io/crates/v/link-assistant-agent.svg)](https://crates.io/crates/link-assistant-agent)
[![License: Unlicense](https://img.shields.io/badge/license-Unlicense-blue.svg)](http://unlicense.org/)

> This is the Rust implementation. See also the [JavaScript/Bun implementation](../js/README.md).

## Status

**Work in Progress** - The Rust implementation provides core functionality but is still under active development. For production use, consider the [JavaScript/Bun version](../js/README.md) which has full feature parity with OpenCode.

### Implemented Features

- JSON Input/Output compatible with OpenCode format
- Plain text input support (auto-converted to JSON)
- Core CLI argument parsing
- Session and message ID generation
- Tool framework with these tools (they follow the JavaScript tools; see
  [Tool compatibility switches](#tool-compatibility-switches)):
  - `bash` - Execute shell commands
  - `read` - Read file contents
  - `write` - Write files
  - `edit` - Edit files with string replacement
  - `multiedit` - Several edits of one file
  - `list` - List directory contents
  - `glob` - File pattern matching
  - `grep` - Text search with regex support
  - `webfetch` - Fetch a URL as text, markdown or HTML
  - `websearch` and `codesearch` - Exa search
  - `batch` - Run up to 10 tool calls in one call
  - `todowrite` and `todoread` - Session todo list

### Not Yet Implemented

- LLM API integration (currently echoes input)
- Task tool (subagent support)
- MCP (Model Context Protocol) support
- Session resume/continue functionality
- Authentication system

## Requirements

- [Rust](https://www.rust-lang.org/tools/install) 1.70 or newer (includes Cargo, Rust's package manager)

## Installation

### Step 1: Install Rust (skip if already installed)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.bashrc  # Or restart your terminal (use ~/.zshrc for Zsh)

# Verify Rust is installed
rustc --version
cargo --version
```

### Step 2: Build from source

```bash
cd rust
cargo build --release

# The binary will be at target/release/agent
./target/release/agent --help
```

### From crates.io

```bash
cargo install link-assistant-agent
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
                                         [default: kilo/nemotron-3-super-free]
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

Run `agent --help` for the full list.

### Tool compatibility switches

The tools follow the JavaScript implementation. Where that changed what an
earlier Rust release did, a switch restores the earlier behaviour. Each
switch is an environment variable (the same name as on the JavaScript side)
with a matching CLI flag; the flag wins over the variable.

| Environment variable | Flag | Default | Effect |
| --- | --- | --- | --- |
| `LINK_ASSISTANT_AGENT_BASH_SHELL` | `--bash-shell` | `auto` | Shell for `bash`: `auto` ($SHELL when it is sh, bash, zsh, dash, ksh, mksh or ash, else bash, else /bin/sh), `legacy` (`bash -c`) or a shell path or name |
| `LINK_ASSISTANT_AGENT_LEGACY_TOOL_OUTPUT` | `--legacy-tool-output` | `false` | Earlier output formats: empty edit/write output, earlier error texts and diff format, head-kept bash output, relative glob paths, files-only grep, ... |
| `LINK_ASSISTANT_AGENT_LEGACY_EDIT_MATCHING` | `--legacy-edit-matching` | `false` | Earlier edit matching: an empty `oldString` overwrites an existing file, unguarded block-anchor matching, no BOM handling, no refusal of disproportionate fuzzy matches |
| `LINK_ASSISTANT_AGENT_GLOB_FOLLOW_SYMLINKS` | `--glob-follow-symlinks` | `false` | `glob`, `grep` and `list` follow symbolic links |
| `LINK_ASSISTANT_AGENT_GREP_HIDDEN` | `--grep-hidden` | `true` | `false` makes `grep` skip hidden files |
| `LINK_ASSISTANT_AGENT_GREP_TIMEOUT_MS` | `--grep-timeout-ms` | `30000` | `grep` time limit, 0 = none |
| `LINK_ASSISTANT_AGENT_READ_MAX_LINES` | `--read-max-lines` | `2000` | Largest `limit` for `read`, 0 = no cap |
| `LINK_ASSISTANT_AGENT_READ_MAX_BYTES` | `--read-max-bytes` | `51200` | Largest `read` output, 0 = no cap |
| `LINK_ASSISTANT_AGENT_READ_ONLY` | `--read-only` | `false` | Drop `bash`, `edit`, `write`, `multiedit` and `patch` |
| `LINK_ASSISTANT_AGENT_DISABLE_TOOLS` | `--disable-tools` | empty | Comma-separated tool ids to drop |

Boolean flags accept `--flag`, `--flag=true` and `--flag=false`; boolean
variables accept `true`/`1` and `false`/`0`.

The Rust CLI runs each tool call in its own process without session state,
so the edit tool does not require a prior read of the file (the JavaScript
`FileTime` check) and needs no per-file lock.

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
