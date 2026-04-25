# Testing Guide

Test files in this repository do **not** use the `.test` suffix on either the JavaScript or Rust side. JavaScript tests live next to their Rust counterparts with matching base names so the two languages stay in lockstep.

## Running Tests Manually

All tests can be executed manually using Bun's built-in test runner (JS) or `cargo test` (Rust).

### Prerequisites

Make sure dependencies are installed:

```bash
bun install
```

### Run Unit Tests (Default)

Unit tests run quickly without API calls. These are the tests that run with `npm test`:

```bash
cd js && npm test
```

This expands to `bun test ./tests/*.js ./tests/*.ts` and covers every JavaScript unit test under `js/tests/` (not the ones in `js/tests/integration/`).

> **Why explicit paths?** Bun's auto-discovery requires the `.test`, `.spec`, `_test_`, or `_spec_` suffix. Because we want the JavaScript file names to match the Rust ones (which never use `.test`), we pass explicit paths instead of relying on auto-discovery.

### Integration Tests

> **Important**: Integration tests make real API calls and should be run **one at a time** to avoid exhausting rate limits. Never run all integration tests at once.

Integration tests live in `js/tests/integration/`. To run a single integration test:

```bash
# Run the basic "hi" integration test (recommended default)
npm run test:integration

# Run a specific integration test
bun test ./js/tests/integration/basic.js
bun test ./js/tests/integration/bash.tools.js
```

### Why Integration Tests Are Separate

The default AI model (`minimax-m2.5-free`) has strict rate limits. Running multiple integration tests in bulk will exhaust the rate limit quota, causing tests to fail or wait for hours.

All integration tests pass `--no-retry-on-rate-limits` to the agent CLI to fail fast instead of waiting when rate limited.

### Run Specific Test Files

```bash
# Run unit test files (note: paths must start with ./)
bun test ./js/tests/retry-fetch.ts
bun test ./js/tests/log-lazy.js
bun test ./js/tests/json-standard-unit.js

# Run a single integration test
bun test ./js/tests/integration/basic.js

# Run integration MCP tests (these don't use AI API)
bun test ./js/tests/integration/mcp.js
```

### Centralized default model overrides

Both languages share an identical override surface so you can change the model used by tests without editing source. The runtime helpers live in `js/src/config/defaults.ts` and `rust/src/defaults.rs`. Test runs honor these environment variables:

- `LINK_ASSISTANT_AGENT_DEFAULT_MODEL`
- `LINK_ASSISTANT_AGENT_DEFAULT_COMPACTION_MODEL`
- `LINK_ASSISTANT_AGENT_DEFAULT_COMPACTION_MODELS`
- `LINK_ASSISTANT_AGENT_DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT`

Explicit CLI options always win over the env vars.

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

Fast tests with no real API calls. The Rust counterpart for each lives at the matching path under `rust/tests/`:

- `agent-config.ts` ↔ `rust/tests/agent_config.rs` — Agent config defaults and verbose mode wiring
- `cli.ts` ↔ `rust/tests/cli.rs` — CLI argument parsing and defaults
- `cli_options.ts` ↔ `rust/tests/cli_options.rs` — Integration tests for every CLI option via the compiled binary
- `compaction-model.ts` ↔ `rust/tests/compaction_model.rs` — Compaction safety margin and overflow detection
- `json-standard-unit.js` ↔ `rust/tests/json_standard_unit.rs` — JSON standard validation and conversions
- `log-lazy.js` ↔ `rust/tests/log_lazy.rs` — Lazy logger evaluation and tagging
- `mcp-timeout.ts` ↔ `rust/tests/mcp_timeout.rs` — MCP tool call timeout handling
- `model-fallback.ts` ↔ `rust/tests/model_fallback.rs` — Model fallback chain
- `model-not-supported.ts` ↔ `rust/tests/model_not_supported.rs` — Unsupported-model error handling
- `model-strict-validation.ts` ↔ `rust/tests/model_strict_validation.rs` — Strict model validation
- `model-validation.ts` ↔ `rust/tests/model_validation.rs` — Model parsing and finish reasons
- `process-name.js` ↔ `rust/tests/process_name.rs` — Runtime process name handling
- `provider-verbose-logging.ts` ↔ `rust/tests/provider_verbose_logging.rs` — Verbose provider log skip conditions
- `retry-fetch.ts` ↔ `rust/tests/retry_fetch.rs` — Retry/back-off logic for HTTP fetch
- `retry-state.js` ↔ `rust/tests/retry_state.rs` — Retry state machine
- `safe-json-serialization.ts` ↔ `rust/tests/safe_json_serialization.rs` — Safe JSON serialization
- `session-usage.ts` ↔ `rust/tests/session_usage.rs` — Token usage and finish-reason metadata
- `sse-usage-extractor.ts` ↔ `rust/tests/sse_usage_extractor.rs` — SSE chunk parsing
- `storage-migration.ts` ↔ `rust/tests/storage_migration.rs` — Storage migration safety
- `temperature-option.ts` ↔ `rust/tests/temperature_option.rs` — `--temperature` parsing
- `token.ts` ↔ `rust/tests/token.rs` — Token estimation
- `verbose-fetch.ts` ↔ `rust/tests/verbose_fetch.rs` — Header sanitization and body preview
- `verbose-http-logging.ts` ↔ `rust/tests/verbose_http_logging.rs` — Verbose HTTP logging
- `verbose-stderr-type.ts` ↔ `rust/tests/verbose_stderr_type.rs` — Stderr interceptor

### Integration Tests (`js/tests/integration/`)

Tests that spawn the agent process and make real API calls. Run **one at a time**. Each has a Rust counterpart under `rust/tests/integration_*.rs`:

- `basic.js` ↔ `rust/tests/integration_basic.rs`
- `bash.tools.js` ↔ `rust/tests/integration_bash_tools.rs`
- `batch.tools.js` ↔ `rust/tests/integration_batch_tools.rs`
- `codesearch.tools.js` ↔ `rust/tests/integration_codesearch_tools.rs`
- `dry-run.js` ↔ `rust/tests/integration_dry_run.rs`
- `edit.tools.js` ↔ `rust/tests/integration_edit_tools.rs`
- `generate-title.js` ↔ `rust/tests/integration_generate_title.rs`
- `glob.tools.js` ↔ `rust/tests/integration_glob_tools.rs`
- `google-cloudcode.js` ↔ `rust/tests/integration_google_cloudcode.rs`
- `grep.tools.js` ↔ `rust/tests/integration_grep_tools.rs`
- `json-standard-claude.js` ↔ `rust/tests/integration_json_standard_claude.rs`
- `json-standard-opencode.js` ↔ `rust/tests/integration_json_standard_opencode.rs`
- `list.tools.js` ↔ `rust/tests/integration_list_tools.rs`
- `mcp.js` ↔ `rust/tests/integration_mcp.rs`
- `models-cache.js` ↔ `rust/tests/integration_models_cache.rs`
- `output-response-model.js` ↔ `rust/tests/integration_output_response_model.rs`
- `plaintext.input.js` ↔ `rust/tests/integration_plaintext_input.rs`
- `provider.js` ↔ `rust/tests/integration_provider.rs`
- `read-image-validation.tools.js` ↔ `rust/tests/integration_read_image_validation_tools.rs`
- `read.tools.js` ↔ `rust/tests/integration_read_tools.rs`
- `resume.js` ↔ `rust/tests/integration_resume.rs`
- `server-mode.js` ↔ `rust/tests/integration_server_mode.rs`
- `socket-retry.js` ↔ `rust/tests/integration_socket_retry.rs`
- `stdin-input-queue.js` ↔ `rust/tests/integration_stdin_input_queue.rs`
- `stream-parse-error.js` ↔ `rust/tests/integration_stream_parse_error.rs`
- `stream-timeout.js` ↔ `rust/tests/integration_stream_timeout.rs`
- `system-message-file.js` ↔ `rust/tests/integration_system_message_file.rs`
- `system-message.js` ↔ `rust/tests/integration_system_message.rs`
- `task.tools.js` ↔ `rust/tests/integration_task_tools.rs`
- `timeout-retry.js` ↔ `rust/tests/integration_timeout_retry.rs`
- `todo.tools.js` ↔ `rust/tests/integration_todo_tools.rs`
- `verbose-env-fallback.js` ↔ `rust/tests/integration_verbose_env_fallback.rs`
- `verbose-hi.js` ↔ `rust/tests/integration_verbose_hi.rs`
- `webfetch.tools.js` ↔ `rust/tests/integration_webfetch_tools.rs`
- `websearch.tools.js` ↔ `rust/tests/integration_websearch_tools.rs`
- `write.tools.js` ↔ `rust/tests/integration_write_tools.rs`

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
