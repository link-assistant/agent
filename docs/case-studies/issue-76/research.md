# CLI Stdin Handling Best Practices Research

## Key Sources

1. [Command Line Interface Guidelines](https://clig.dev/) - Comprehensive CLI UX guide
2. [Node.js TTY Documentation](https://nodejs.org/api/tty.html) - Official TTY API
3. [12 Factor CLI Apps](https://medium.com/@jdxcode/12-factor-cli-apps-dd3c227a0e46) - CLI best practices
4. [Node.js CLI Apps Best Practices](https://github.com/lirantal/nodejs-cli-apps-best-practices) - Community best practices
5. [Stylelint PR #7131](https://github.com/stylelint/stylelint/pull/7131) - Example of fixing stdin waiting behavior
6. [Heroku CLI Style Guide](https://devcenter.heroku.com/articles/cli-style-guide) - Enterprise CLI patterns

## Key Findings

### 1. Don't Hang Waiting for Stdin

From clig.dev:

> "If your command is expecting to have something piped to it and stdin is an interactive terminal, display help immediately and quit. This means it doesn't just hang, like cat. Alternatively, you could print a log message to stderr."

From Stylelint PR:

> "just running the stylelint command immediately exits, instead of waiting. I believe this behavior is more user-friendly."

### 2. TTY Detection is Standard Practice

From Node.js TTY documentation:

> "The preferred method of determining whether Node.js is being run within a TTY context is to check that the value of the `process.stdout.isTTY` property is true."

> "When running in a terminal it returns `true`, but when piped (e.g., `| cat`) it returns `false`."

### 3. Never Require Prompts

From 12 Factor CLI Apps:

> "Never require a prompt. Always provide a way of passing input with flags or arguments. If stdin is not an interactive terminal, skip prompting and just require those flags/args."

> "For accepting input, if stdin is a tty then prompt rather than forcing the user to specify a flag. Never require a prompt though. The user needs to be able to automate your CLI in a script so allow them to override prompts always."

### 4. Standard Help/Version Flags

From 12 Factor CLI Apps:

> "-V (capitalized) and of course --version. These should both work, just like -h and --help should both work."

### 5. Exit Immediately When No Input

From multiple sources:

- Check `isatty()` or `isTTY` to determine if input is piped or interactive
- Exit immediately rather than blocking when no input is provided in interactive mode
- Support `-h`/`--help` and `-V`/`--version` flags

## Application to Issue #76

### Problem Statement

When running `agent` without arguments, the CLI hangs indefinitely waiting for stdin input that will never come in an interactive terminal.

### Expected Behavior (Based on Research)

1. **TTY Detection**: Check if stdin is a TTY (interactive terminal)
2. **Show Help**: If TTY and no arguments, show help and exit
3. **Provide Flags**: Offer `-p`/`--prompt` as explicit input method
4. **Status Message**: When waiting for stdin, output a status message explaining what the CLI is doing
5. **Keyboard Shortcut Guidance**: Mention CTRL+C to exit and `--help` for more info

### Recommended Implementation

1. **Primary Check**: `process.stdin.isTTY` - if true and no command/prompt provided, show help
2. **Stdin Listening Mode**: When stdin is NOT a TTY (piped), output a JSON status message
3. **Explicit Prompt Flag**: `-p`/`--prompt` bypasses stdin waiting entirely
4. **No Default Timeout**: Don't use timeout by default (allows long JSON inputs)
5. **Optional Timeout**: `--stdin-stream-timeout` for users who want timeout behavior
