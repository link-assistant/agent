# System Message Configuration for opencode/grok-code Model

## Issue Summary

User inquired about support for `--system-message` or `--append-system-message` options and where system messages are configured for the default model `opencode/grok-code`.

## Investigation Findings

### CLI Options Support

- **No support for `--system-message` or `--append-system-message`**: The codebase does not implement these command-line options. A comprehensive search found no references to these flags in the CLI command definitions or flag configurations.

### System Message Configuration Location

- **Default model**: `opencode/grok-code` is set as the default model in `src/index.js:31`
- **System prompt resolution**: System prompts are dynamically constructed in the `resolveSystemPrompt` function located in `src/session/prompt.ts:606-621`
- **Model-specific prompt selection**: The system uses `SystemPrompt.provider(modelID)` to determine which base prompt to use based on the model identifier

### System Prompt for opencode/grok-code

Since `grok-code` doesn't match any of the specific model patterns (gpt-5, gpt-, gemini-, claude, polaris-alpha), it falls back to the default prompt defined in `src/session/prompt/qwen.txt`.

The complete system prompt construction follows this order:

1. **Header**: Provider-specific header (none for opencode)
2. **Base prompt**: Content from `qwen.txt` (the opencode system prompt)
3. **Environment info**: Current working directory, git status, platform, date
4. **Custom instructions**: Content from `AGENTS.md`, `CLAUDE.md`, or `CONTEXT.md` files if present

### Alternative System Message Methods

While direct CLI flags aren't supported, users can customize system messages through:

- **AGENTS.md file**: Place in project root or `~/.opencode/` directory
- **CLAUDE.md file**: Global configuration at `~/.claude/CLAUDE.md`
- **Config instructions**: Via `opencode.json` configuration file
- **Agent-specific prompts**: When using custom agents created with `opencode agent create`

## Resolution

The codebase does not support `--system-message` or `--append-system-message` CLI options. Instead, it provides flexible system prompt configuration through file-based instructions and agent definitions, allowing for more persistent and project-specific customization.
