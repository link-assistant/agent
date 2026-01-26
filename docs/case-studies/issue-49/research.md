# CLI Debug Logging Best Practices Research

## Sources

### Stderr vs Stdout Separation

- [Configuring CLI output verbosity with logging and argparse](https://xahteiwi.eu/resources/hints-and-kinks/python-cli-logging-options/)
- [The CLI's Essential '—Verbose' Option - Dojo Five](https://dojofive.com/blog/the-clis-essential-verbose-option/)

### Verbose Flag Implementation

- [Verbose Logging](https://medium.com/@pooja_virani/verbose-logging-a60cccb3eb66)
- [Go Flags: Beyond the Basics](https://dzone.com/articles/go-flags-beyond-the-basics)

### Debug Output and User Experience

- [Debugging - Better CLI](https://bettercli.org/design/debugging/)
- [Mastering CLI Design: Best Practices](https://jsschools.com/programming/mastering-cli-design-best-practices-for-powerful-/)

## Key Best Practices

### 1. Stderr vs Stdout Separation

Log output that tells users about what the program is doing should go to stderr, while output related to the program's results goes to stdout, giving users the ability to pipe stdout without interference.

### 2. Verbose Flag Implementation

By default, CLIs should log only warnings and errors to stderr, but when debugging issues, enable more verbose logging by passing a --verbose flag. Common patterns include:

- Using `-v` for INFO level and `-vv` for DEBUG level
- Verbose logging with `-v` flag, with log levels between 1 and 11 for increasing verbosity

### 3. Default Behavior

Events of severity WARNING and greater should be printed to sys.stderr by default, which is regarded as the best default behavior.

### 4. Quiet Mode

Also define a `-q` or `--quiet` option that suppresses warnings and shows only errors.

### 5. Output Guidelines

Keep reporting short and sweet, especially on successful runs - only mention important parts, and be descriptive but short.

### 6. Debug Mode for Programs

Debug log messages from your program are hidden by default, but can be shown using the `-d` or `--debug` flag.

### 7. Standard Debug Flags

CLI tools commonly provide flags like -d/--debug, -v/--verbose, DEBUG environment variable or similar debugging options, and these flags should be implemented as global options, meaning they could be used in any command and in any combination.

### 8. Conditional Debug Output for Better UX

When handling errors in CLI tools, you can conditionally show detailed information: if debug mode is enabled, display full traceback information; otherwise, show a simple error message and suggest running with --debug for details. This approach prevents overwhelming users with technical output during normal operation while still making debugging information accessible when needed.

### 9. Impact on User Experience

How your CLI presents information significantly impacts user experience. Debug output can create challenges:

- **Console flooding**: Debug messages can overload the console, making it difficult to use the CLI effectively
- **Performance impact**: Enabling debugging can disrupt operation when systems are experiencing high load conditions
- **Usability issues**: Without proper controls, debug output can make tools difficult to use in production environments

### 10. Recommendations

The key is to keep debug output disabled by default and provide explicit flags for users who need it, ensuring that regular users enjoy a clean, focused experience while developers and troubleshooters can access detailed information when necessary.

## Application to Agent CLI

Based on these best practices, the Agent CLI should:

1. **Suppress all INFO/DEBUG logs by default** - Only show warnings and errors
2. **Enable verbose logging with --verbose flag** - Show INFO/DEBUG when explicitly requested
3. **Initialize logging early** - Before any commands execute, initialize the logging system
4. **Use log files for background operations** - Write non-critical logs to files instead of stderr
5. **Keep CLI output clean** - Only show user-relevant information by default
