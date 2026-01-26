# Testing Guide

## Running Tests Manually

All tests can be executed manually using Bun's built-in test runner.

### Prerequisites

Make sure dependencies are installed:

```bash
bun install
```

### Run All Tests

To run the complete test suite:

```bash
bun test
```

### Run Specific Test Files

You can run individual test files:

```bash
# Run MCP tests
bun test tests/mcp.test.js

# Run basic tests
bun test tests/basic.test.js

# Run tool tests
bun test tests/bash.tools.test.js
bun test tests/read.tools.test.js
bun test tests/write.tools.test.js
bun test tests/edit.tools.test.js
bun test tests/glob.tools.test.js
bun test tests/grep.tools.test.js
bun test tests/list.tools.test.js
bun test tests/todo.tools.test.js
bun test tests/task.tools.test.js
bun test tests/batch.tools.test.js
bun test tests/websearch.tools.test.js
bun test tests/codesearch.tools.test.js
bun test tests/webfetch.tools.test.js

# Run input/message tests
bun test tests/plaintext.input.test.js
bun test tests/system-message.test.js
bun test tests/system-message-file.test.js

# Run server mode tests
bun test tests/server-mode.test.js
```

### Run Tests with Pattern Matching

Bun allows you to filter tests by pattern:

```bash
# Run all tool tests
bun test tests/*.tools.test.js

# Run all input tests
bun test tests/*.input.test.js
```

## Continuous Integration

Tests are configured to run manually via GitHub Actions workflow dispatch.

### Triggering CI Tests Manually

1. Go to the [Actions tab](https://github.com/link-assistant/agent/actions)
2. Select the "Tests" workflow
3. Click "Run workflow" button
4. Select the branch you want to test
5. Click "Run workflow" to start the test run

The CI workflow will:

1. Install dependencies
2. Run the full test suite with `bun test`
3. Execute MCP CLI command tests

## Test Structure

### MCP Tests (`tests/mcp.test.js`)

The MCP test suite validates:

- CLI command help output
- Configuration file generation
- Playwright MCP support
- Multi-argument command handling
- Remote server configuration
- Configuration preservation

**11 tests total** covering all MCP functionality.

### Tool Tests

Each tool has a dedicated test file validating:

- Tool execution
- Output format compatibility with OpenCode
- JSON structure validation
- Error handling

### Integration Tests

- `tests/basic.test.js` - Basic agent functionality
- `tests/server-mode.test.js` - HTTP server mode
- `tests/plaintext.input.test.js` - Plain text input handling
- `tests/system-message*.test.js` - System message configuration

## Troubleshooting

### Missing Dependencies

If you see errors about missing modules:

```bash
bun install
```

### Test Failures

1. Check that you're using Bun >= 1.0.0:

   ```bash
   bun --version
   ```

2. Ensure all dependencies are installed:

   ```bash
   rm -rf node_modules
   bun install
   ```

3. Run tests in verbose mode to see detailed output:
   ```bash
   bun test --verbose
   ```
