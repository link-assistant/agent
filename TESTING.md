# Testing Guide

## Running Tests Manually

All tests can be executed manually using Bun's built-in test runner.

### Prerequisites

Make sure dependencies are installed:

```bash
bun install
```

### Run Unit Tests (Default)

Unit tests run quickly without API calls. These are the tests that run with `bun test`:

```bash
bun test
```

Unit tests are in `js/tests/` (not in `js/tests/integration/`).

### Integration Tests

> **Important**: Integration tests make real API calls and should be run **one at a time** to avoid exhausting rate limits. Never run all integration tests at once with `bun test` — this is intentionally prevented by the test configuration.

Integration tests live in `js/tests/integration/`. To run a single integration test:

```bash
# Run the basic "hi" integration test (recommended default)
bun run test:integration

# Run a specific integration test
bun test js/tests/integration/basic.test.js
bun test js/tests/integration/bash.tools.test.js
```

### Why Integration Tests Are Separate

The default AI model (`minimax-m2.5-free`) has strict rate limits. Running multiple integration tests in bulk will exhaust the rate limit quota, causing tests to fail or wait for hours.

All integration tests pass `--no-retry-on-rate-limits` to the agent CLI to fail fast instead of waiting when rate limited.

### Run Specific Test Files

```bash
# Run unit test files
bun test js/tests/retry-fetch.test.ts
bun test js/tests/log-lazy.test.js
bun test js/tests/json-standard-unit.test.js

# Run a single integration test
bun test js/tests/integration/basic.test.js

# Run integration MCP tests (these don't use AI API)
bun test js/tests/integration/mcp.test.js
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
2. Run unit tests with `bun test`
3. Run the basic integration test

## Test Structure

### Unit Tests (`js/tests/`)

Fast tests with no real API calls:
- `log-lazy.test.js` - Logger lazy evaluation
- `json-standard-unit.test.js` - JSON format conversions
- `model-validation.test.ts` - Model ID validation
- `session-usage.test.ts` - Session usage tracking
- `retry-state.test.js` - Retry state machine
- `retry-fetch.test.ts` - HTTP fetch retry logic (mocked)
- `safe-json-serialization.test.ts` - Safe JSON serialization
- `process-name.test.js` - Process name setting
- `model-not-supported.test.ts` - Model error detection
- `model-fallback.test.ts` - Model fallback logic
- `mcp-timeout.test.ts` - MCP timeout handling
- `verbose-http-logging.test.ts` - Verbose HTTP logging

### Integration Tests (`js/tests/integration/`)

Tests that spawn the agent process and make real API calls. Run **one at a time**:

- `basic.test.js` - Basic agent functionality (sends "hi")
- `bash.tools.test.js` - Bash tool execution
- `batch.tools.test.js` - Batch operations
- `codesearch.tools.test.js` - Code search tool
- `dry-run.test.js` - Dry run mode
- `edit.tools.test.js` - File edit tool
- `generate-title.test.js` - Session title generation
- `glob.tools.test.js` - File glob tool
- `google-cloudcode.test.js` - Google Cloud Code provider
- `grep.tools.test.js` - File grep tool
- `json-standard-claude.test.js` - Claude JSON format
- `json-standard-opencode.test.js` - OpenCode JSON format
- `list.tools.test.js` - File list tool
- `mcp.test.js` - MCP configuration (no AI API calls)
- `models-cache.test.js` - Model caching
- `output-response-model.test.js` - Response model output
- `plaintext.input.test.js` - Plain text input
- `provider.test.js` - Provider configuration
- `read-image-validation.tools.test.js` - Image validation
- `read.tools.test.js` - File read tool
- `resume.test.js` - Session resume/continue
- `server-mode.test.js` - HTTP server mode
- `socket-retry.test.js` - Socket error retry
- `stdin-input-queue.test.js` - Stdin queue handling
- `stream-parse-error.test.js` - Stream parse errors
- `stream-timeout.test.js` - Stream timeouts
- `system-message-file.test.js` - System message from file
- `system-message.test.js` - System message override
- `task.tools.test.js` - Task tool
- `timeout-retry.test.js` - Timeout and retry
- `todo.tools.test.js` - Todo tool
- `webfetch.tools.test.js` - Web fetch tool
- `websearch.tools.test.js` - Web search tool
- `write.tools.test.js` - File write tool

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

### Rate Limit Errors in Integration Tests

Integration tests use `--no-retry-on-rate-limits` to fail fast when rate limited instead of waiting. If you see rate limit errors:

1. Wait for the rate limit window to reset (check `retry-after` header in the error)
2. Use a different API key or model
3. Run only one integration test at a time: `bun test js/tests/integration/basic.test.js`
