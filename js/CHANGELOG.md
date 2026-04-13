# @link-assistant/agent

## 0.22.6

### Patch Changes

- 7cbdfbe: Added shared concurrency group to JS release jobs to prevent race condition with Rust CI/CD pushes to main

## 0.22.5

### Patch Changes

- df1566f: Add CARGO_TOKEN fallback support to publish-to-crates.mjs for organization-level secrets

## 0.22.4

### Patch Changes

- f0c7865: Add publish verification to Rust CI/CD to prevent false positive releases

## 0.22.3

### Patch Changes

- ddf3008: Fix Rust CI/CD publishing by committing Cargo.lock in version bump to prevent cargo publish failure

## 0.22.2

### Patch Changes

- 63b606d: fix: update create-github-release.mjs to support both JS and Rust changelog formats (#247)
  - Fixed changelog version regex to handle Rust's `## [version] - date` format alongside JS's `## version` format
  - Previously the regex would fail to extract release notes for Rust releases due to unescaped `[` brackets and dots

## 0.22.1

### Patch Changes

- df87e66: Lower compaction safety margin from 85% to 75% to reduce context overflow errors. Add token estimation fallback when providers return 0 token counts. Cap maxOutputTokens to never exceed model context limit.

## 0.22.0

### Minor Changes

- 6463a14: feat: add --temperature CLI option for model completion override (#241)
  - Added `--temperature` flag to JS and Rust CLI implementations
  - When set, overrides per-model and per-agent temperature defaults
  - When not set, existing behavior is unchanged
  - Temperature flows through PromptInput schema and User message to AI SDK
  - Priority chain: CLI --temperature > agent config > model defaults

## 0.21.0

### Minor Changes

- c0e8566: feat: replace deprecated qwen3.6-plus-free default with nemotron-3-super-free (#242)
  - Default model changed from `qwen3.6-plus-free` to `nemotron-3-super-free` (~262K context, NVIDIA hybrid Mamba-Transformer)
  - Removed `qwen3.6-plus-free` from compaction models cascade (free promotion ended April 2026)
  - Updated provider priority lists to remove unavailable model
  - Moved `qwen3.6-plus-free` to deprecated/discontinued sections in documentation

## 0.20.2

### Patch Changes

- 4fcc366: fix: resolve Agent CLI problems preventing task completion (#239)
  - `argv.ts`: harden getModelFromProcessArgv() with Bun.argv fallback for global installs (oven-sh/bun#22157)
  - `model-config.js`: add diagnostic logging for model resolution, detect silent Bun/yargs argument parsing mismatch
  - `storage.ts`: sanitize null bytes in migration paths before file operations
  - `prompt.ts`: check for completed tool calls BEFORE zero-token check — prevents premature session termination when provider reports zero tokens but model executed tool calls successfully

## 0.20.1

### Patch Changes

- fix: verbose log messages no longer emitted as "type": "error" events (#235)
  - `provider.ts`: replace `process.stderr.write()` with `log.debug()` for verbose HTTP logging diagnostic breadcrumb — prevents stderr interceptor from wrapping it as `"type": "error"`
  - `verbose-fetch.ts`: exit handler now writes proper JSON `{"type": "log", "level": "warn", ...}` instead of plain text `[verbose]` prefix
  - `index.js`: stderr interceptor now wraps `[verbose]`/`[debug]` prefixed messages as `"type": "log"` instead of `"type": "error"` — a safety net for any remaining plain-text verbose messages
  - Consumers (like Hive Mind's solve.mjs) no longer see false error events from verbose mode

## 0.20.0

### Minor Changes

- 5d34ecd: feat: make qwen3.6-plus-free the default model, add compaction models cascade (#232)
  - Change default model from `minimax-m2.5-free` to `qwen3.6-plus-free` (~1M context)
  - Add `--compaction-models` CLI option for cascading compaction models
  - Default cascade: `(big-pickle nemotron-3-super-free minimax-m2.5-free gpt-5-nano qwen3.6-plus-free same)`
  - Add `nemotron-3-super-free` and `qwen3.6-plus-free` to free models lists
  - Update documentation and provider priority lists

## 0.19.2

### Patch Changes

- 2aeddd6: Fail immediately when explicit model not found in provider, retry server errors (500/502/503), improve logging for HTTP responses, storage migrations, and verbose diagnostics

## 0.19.1

### Patch Changes

- fix: fail immediately when explicit model not found instead of silent fallback (#231)
  - `model-config.js`: throw error instead of warning when explicit `provider/model` specifies a model not found in the provider catalog (previously kimi-k2.5-free was silently routed to minimax-m2.5-free)
  - `provider.ts`: throw `ModelNotFoundError` instead of creating synthetic fallback model info for unknown models after cache refresh
  - `provider.ts`: change stderr verbose diagnostic prefix from `[verbose]` to `[debug]` to avoid outer solver's error detection false positive
  - `retry-fetch.ts`: retry server errors (500, 502, 503) up to 3 times with exponential backoff — prevents lost compaction cycles from intermittent OpenCode API failures
  - `auth/plugins.ts`: add 500 and 502 to retryable HTTP status codes
  - `verbose-fetch.ts`: track pending async stream log operations and warn at process exit if HTTP response bodies were not logged
  - `storage.ts`: log actual error details (name, message, stack) for migration failures instead of swallowing the error
  - Add case study analysis for the issue with timeline reconstruction and root cause analysis

## 0.19.0

### Minor Changes

- effbcfb: feat: centralize agent config with lino-arguments, always log resolved config (#227)
  - Added `lino-arguments` for unified env var resolution (case-insensitive, .lenv support)
  - Created centralized `AgentConfig` module as single source of truth for all configuration
  - All env vars resolved via `getenv()` from lino-arguments (CLI args > env vars > .lenv > defaults)
  - Always log resolved configuration as JSON at startup for debugging
  - Moved all direct `process.env` reads (MCP, read tool) into centralized Flag module
  - `--verbose` is now the most reliable flag: triple-checked via in-memory, AgentConfig, and env var
  - Removed all `OPENCODE_*` env var support; use `LINK_ASSISTANT_AGENT_*` exclusively

## 0.18.3

### Patch Changes

- b3989c2: fix: use compaction model (--compaction-model) for summarization to avoid doubling rate-limit pressure on free-tier main models (#223)

## 0.18.1

### Patch Changes

- e66584f: fix: enable dual HTTP logging (global fetch patch + provider-level wrapper) for complete verbose mode coverage (#221)

## 0.18.0

### Minor Changes

- 74cb3e1: Add --compaction-model (default: opencode/gpt-5-nano) and --compaction-safety-margin (default: 15%) CLI options. When the compaction model has a larger context window than the base model, the safety margin is automatically removed, allowing 100% usage of the base model's usable context. This extends effective working context by ~18% for free tier models at zero cost.

## 0.17.0

### Minor Changes

- 99b34ec: Enable --summarize-session by default and use the same model as --model for session summarization. Add 15% safety margin to compaction overflow detection, context diagnostics to step-finish JSON output, and detailed logging for overflow checks.

## 0.16.18

### Patch Changes

- 7884084: feat: improve verbose HTTP logging reliability (#215)
  - Add diagnostic breadcrumb log ("verbose HTTP logging active") on first HTTP call per provider to confirm the fetch wrapper is in the chain
  - Pass Bun's non-standard `verbose: true` option to fetch() when verbose mode is enabled, enabling detailed connection debugging for socket errors
  - Include stack trace and error.cause in HTTP request failed log entries for better debugging of connection failures
  - Add case study documenting the "socket connection closed unexpectedly" error analysis

## 0.16.17

### Patch Changes

- 9605cfd: fix: prevent agent process leaks with event loop fixes and ESLint rules (#213)
  - Fix setTimeout/setInterval in retry-fetch.ts, session/retry.ts, and util/timeout.ts to use .unref() so timers don't prevent process exit
  - Fix Bun.serve() idleTimeout from 0 (infinite) to 255 (default) to prevent keeping event loop alive
  - Fix setTimeout in continuous-mode.js waitForPending to use .unref()
  - Use process.once('SIGINT') instead of process.on('SIGINT') to prevent handler accumulation
  - Fix missing error listener removal in input-queue.js stop()
  - Add eslint-plugin-promise for detecting dangling/floating promises
  - Add no-restricted-syntax ESLint rules to warn on process.on('SIGINT'/'SIGTERM') — prefer process.once()
  - Remove AGENT_PROCESS_LIFETIME_TIMEOUT (agents can run for hours, global timeout is not appropriate)
  - Add --retry-on-rate-limits flag (use --no-retry-on-rate-limits to disable AI API rate limit retries)
  - Move integration tests to tests/integration/ to prevent bulk running; default bun test runs only unit tests

## 0.16.16

### Patch Changes

- 008aa52: fix: HTTP verbose logging and anthropic provider usage fallback (#211)

  Two fixes for issues observed when running the Agent CLI with `--verbose`
  mode and the `opencode/minimax-m2.5-free` model:
  1. **HTTP request/response logging not appearing in verbose mode**: The
     lazy log callback pattern (`log.info(() => ({...}))`) passed through
     the `log-lazy` npm package, adding indirection that could lose output
     when the CLI runs as a subprocess. Changed all 5 HTTP log call sites
     to use direct calls (`log.info('msg', data)`) since the verbose check
     is already done at the top of the wrapper.
  2. **"Provider returned zero tokens with unknown finish reason" error**:
     When using `@ai-sdk/anthropic` SDK with a custom baseURL (opencode
     proxy), the standard AI SDK usage object is empty but
     `providerMetadata.anthropic.usage` contains valid token data with
     snake_case keys (`input_tokens`, `output_tokens`). Added an anthropic
     metadata fallback in `getUsage()` to extract tokens from this
     metadata, similar to the existing OpenRouter fallback.

## 0.16.14

### Patch Changes

- 1c5ffd1: fix: centralize default model constant and update from kimi-k2.5-free to minimax-m2.5-free (#208)

  The yargs default model in `index.js`, the OAuth fallback check in
  `model-config.js`, and the task tool fallback in `task.ts` referenced
  `opencode/kimi-k2.5-free`, which was discontinued on the OpenCode Zen
  provider. Runs that did not pass `--model` explicitly (or where the
  yargs caching bug #192 caused the CLI argument to be silently dropped)
  would attempt to use the removed model and fail with a 401 ModelError.

  Additionally, the default model was hardcoded in multiple files, making
  future updates error-prone (as demonstrated by this issue).

  Changes:
  - `js/src/cli/defaults.ts`: new file exporting `DEFAULT_MODEL`,
    `DEFAULT_PROVIDER_ID`, and `DEFAULT_MODEL_ID` constants — the single
    source of truth for the default model
  - `js/src/index.js`: import and use `DEFAULT_MODEL` constant for the
    `--model` yargs default
  - `js/src/cli/model-config.js`: import and use `DEFAULT_PROVIDER_ID`
    and `DEFAULT_MODEL_ID` constants in the `--use-existing-claude-oauth`
    check and error messages
  - `js/src/tool/task.ts`: import and use `DEFAULT_PROVIDER_ID` and
    `DEFAULT_MODEL_ID` constants as the fallback model

## 0.16.13

### Patch Changes

- 4377c1d: fix: detect model-not-supported errors from provider response body (#208)

  When the OpenCode provider (and similar OpenRouter-compatible proxies) removes
  or restricts access to a model, the API returns HTTP 401 with a response body
  like `{"type":"error","error":{"type":"ModelError","message":"Model X not
supported"}}`. Without special handling this looks identical to a real
  authentication failure, making the root cause hard to diagnose.

  The fix adds `SessionProcessor.isModelNotSupportedError()` which parses the
  response body and detects the `ModelError` pattern from OpenCode/OpenRouter.
  When detected, a dedicated error log entry is emitted that:
  - Clearly labels the error as a model-availability issue, NOT an auth error
  - Includes the providerID, modelID, and full response body
  - Suggests using `--model <provider>/<model-id>` to specify an alternative
  - Links to the case study for further investigation

  The fix also adds 11 unit tests covering nested/flat JSON formats, real auth
  errors (should not be flagged), plain-text fallback detection, and edge cases.

  Root cause documented in `docs/case-studies/issue-208/` with the full
  1920-line log from the failing run.

## 0.16.12

### Patch Changes

- d843fb2: fix: check verbose flag at HTTP call time, not SDK creation time (#206)

  The verbose HTTP logging wrapper now checks `Flag.OPENCODE_VERBOSE` when each
  HTTP request is made, instead of when the provider SDK is created. Previously,
  the wrapper was conditionally installed at SDK creation time using
  `if (Flag.OPENCODE_VERBOSE)`, which meant that if the SDK was cached before
  the `--verbose` flag was processed by the CLI middleware, no HTTP logging would
  occur for the entire session.

  The fix always installs the fetch wrapper but makes it a no-op passthrough
  (single boolean check) when verbose mode is disabled, ensuring zero overhead
  in normal operation and reliable logging when `--verbose` is enabled.

## 0.16.11

### Patch Changes

- 5dbfc0e: feat: log HTTP response body in verbose mode for debugging provider failures (#204)

  When `--verbose` is enabled, the raw HTTP response body from LLM providers is now
  also logged. For streaming (SSE) responses, the stream is tee'd so the AI SDK receives
  the full response while a preview (up to 4000 chars) is logged asynchronously. For
  non-streaming responses, the body is buffered, logged, and the Response is reconstructed
  transparently.

  This provides the missing visibility needed to diagnose issues like empty responses,
  malformed SSE events, or error messages from providers like opencode/kimi-k2.5-free.

## 0.16.10

### Patch Changes

- 8abdac4: Fix model resolution failures and ensure JSON-only output (#200)
  - Try unlisted models instead of throwing ProviderModelNotFoundError
  - Auto-refresh models.dev cache when model not found in catalog
  - Intercept stderr to wrap Bun's plain-text errors in JSON envelope
  - Add unit tests for model fallback and JSON error wrapping
  - Add case study documentation with root cause analysis

## 0.16.9

### Patch Changes

- 47a4c9f: fix: improve error serialization and verbose debug output for model resolution
  - Added cyclic-reference-safe JSON serialization for all error output
  - Improved global error handlers with guaranteed JSON output and last-resort fallback
  - Added model resolution verbose logging for debugging
  - Restored `opencode/kimi-k2.5-free` as default model (confirmed available on models.dev)

## 0.16.8

### Patch Changes

- 732fe74: Add verbose HTTP logging for debugging provider issues and improve model-not-found error messages to list available models

## 0.16.7

### Patch Changes

- c51339d: fix: export Provider.state and improve zero-token error handling (#198)

## 0.16.6

### Patch Changes

- fix: export Provider.state and improve zero-token error handling (#198)
  - Export Provider.state from namespace so model validation actually works
    (was always throwing TypeError, causing validation to be silently skipped)
  - Publish error event when zero-token + unknown finish reason detected,
    so JSON standard output includes actionable error with model/provider info
  - Add step-level warning in processor with raw response metadata for debugging
  - Add case study analysis with timeline reconstruction and root cause analysis

## 0.16.5

### Patch Changes

- dd56300: fix: validate model argument and detect zero-token provider failures (#196)
  - Always prefer CLI model argument over yargs default to prevent silent model substitution
  - Throw on invalid provider/model format instead of falling back to defaults
  - Warn when explicit model not found in provider's model list
  - Detect zero-token responses with unknown finish reason as provider failures
  - Add case study documentation for incident analysis

## 0.16.4

### Patch Changes

- 3e487e2: Add safeguard for model argument mismatch detection

  Added a safeguard to detect and correct mismatches between yargs-parsed model arguments and actual process.argv values. This addresses issue #192 where `--model kilo/glm-5-free` was incorrectly substituted with `opencode/kimi-k2.5-free` due to potential Bun runtime cache issues.

  The safeguard:
  - Extracts the model argument directly from process.argv
  - Compares it with the yargs-parsed value
  - Logs a warning and uses the correct CLI value when a mismatch is detected

## 0.16.3

### Patch Changes

- 5a0e6d2: Update free models: replace minimax-m2.1-free with minimax-m2.5-free
  - Replace `minimax-m2.1-free` with `minimax-m2.5-free` in OpenCode Zen (M2.1 no longer free)
  - Remove `glm-4.7-free` from free models (no longer available)
  - Update Kilo Gateway free models: add GLM 4.5 Air, DeepSeek R1, update MiniMax to M2.5
  - Update provider priority lists in `getSmallModel()` function
  - Add FREE_MODELS.md comprehensive documentation

  Breaking change: Users relying on `opencode/minimax-m2.1-free` or `opencode/glm-4.7-free`
  should switch to `opencode/minimax-m2.5-free` or other free models listed in FREE_MODELS.md.

## 0.16.2

### Patch Changes

- 126fe08: fix: extract usage and finish reason from OpenRouter provider metadata

  When using OpenRouter-compatible APIs (like Kilo Gateway), the standard AI SDK usage object may be empty while the actual usage data is in `providerMetadata.openrouter.usage`. This fix adds fallback logic to extract token counts and finish reason from provider metadata.

  This enables accurate token counting and cost calculation for all OpenRouter-compatible providers including Kilo Gateway.

## 0.16.1

### Patch Changes

- 5cf47cf: fix: resolve incorrect peer dependency warning for ai@6.0.86
  - Update @openrouter/ai-sdk-provider from ^1.5.4 to ^2.2.3 (supports AI SDK v6)
  - Update @opentui/core from ^0.1.46 to ^0.1.79
  - Update @opentui/solid from ^0.1.46 to ^0.1.79

  This fixes the `warn: incorrect peer dependency "ai@6.0.86"` warning that
  appeared during `bun install` because @openrouter/ai-sdk-provider@1.x
  required ai@^5.0.0 while we use ai@^6.0.1.

  Note: The `solid-js` peer dependency warning remains due to an upstream
  issue in @opentui/solid which uses exact version pinning. This has been
  reported at https://github.com/anomalyco/opentui/issues/689

  Fixes #186

## 0.16.0

### Minor Changes

- 5024dd4: Bundle AI SDK providers to prevent runtime installation timeouts
  - Added common AI SDK providers as static dependencies
  - Created BUNDLED_PROVIDERS map to check bundled packages first
  - Fall back to dynamic installation only for non-bundled providers
  - Fixes issue where `--model kilo/glm-5-free` would hang indefinitely

  This addresses known Bun package installation issues that cause timeouts.

## 0.14.0

### Minor Changes

- 17e891f: Add --output-response-model and --summarize-session flags for auxiliary task control

  ## Changes

  ### New Flags
  1. **`--output-response-model`** (or `AGENT_OUTPUT_RESPONSE_MODEL=true`)
     When enabled, includes model information in `step_finish` parts:

     ```json
     {
       "type": "step_finish",
       "part": {
         "model": {
           "providerID": "opencode",
           "requestedModelID": "big-pickle",
           "respondedModelID": "gpt-4o-mini-2024-07-18"
         }
       }
     }
     ```

  2. **`--summarize-session`** (or `AGENT_SUMMARIZE_SESSION=true`)
     Controls AI-powered session summarization. **Disabled by default** to save tokens.
     When enabled, generates summaries using a small/cheap model.

  ### Token Savings

  By default, both `--generate-title` and `--summarize-session` are now disabled,
  which means:
  - No auxiliary models are loaded when all auxiliary tasks are disabled
  - No extra tokens are consumed for title generation or session summarization
  - Users can explicitly enable these features when needed

  ### Renamed Fields

  The model info schema now uses clearer field names:
  - `modelID` → `requestedModelID` (the model you asked for)
  - `responseModelId` → `respondedModelID` (the actual model that responded)

  This helps clarify the distinction between what was requested and what actually
  processed the request.

  Fixes #179

## 0.13.5

### Patch Changes

- 34f4877: Add unit suffixes to all time-related log fields for clarity

  Standardized all time-related log fields in retry-fetch.ts and session/retry.ts
  to include the Ms (milliseconds) suffix, making logs crystal clear and eliminating
  confusion about time units.

  Changes:
  - retry-fetch.ts: Renamed delay→delayMs, elapsed→elapsedMs, remainingTimeout→remainingTimeoutMs,
    minInterval→minIntervalMs, maxRetryTimeout→maxRetryTimeoutMs, backoffDelay→backoffDelayMs,
    maxBackoffDelay→maxBackoffDelayMs
  - session/retry.ts: Renamed elapsedTime→elapsedTimeMs, maxTime→maxTimeMs,
    backoffDelay→backoffDelayMs, maxBackoffDelay→maxBackoffDelayMs, maxCap→maxCapMs

  This is a logging-only change with no functional impact. All tests pass.

  Fixes #181

- b5d4705: fix: resolve CLI warnings by fixing root causes
  - Add package staleness check to refresh 'latest' packages after 24 hours
    - Fixes specificationVersion v2 warning by ensuring @ai-sdk/openai-compatible is updated to v2.x (with v3 spec support)
  - Change models.dev cache fallback message from 'warn' to 'info' level
    - Using bundled data is expected fallback behavior, not a warning condition

## 0.13.4

### Patch Changes

- 08d9e95: Fix rate limit wait being aborted by provider timeout (#183)

  When a rate limit (429) response includes a long retry-after header (e.g., 15 hours),
  the agent would fail with "The operation timed out." after only 5 minutes. This occurred
  because the rate limit wait shared the same AbortSignal as the provider timeout.

  Solution: Use isolated AbortController for rate limit waits that only respects the global
  AGENT_RETRY_TIMEOUT (default 7 days), not provider-level timeouts.

  Key changes:
  - Added createIsolatedRateLimitSignal() for rate limit waits
  - Rate limit waits now periodically check for user cancellation (every 10s)
  - Proper cleanup of event listeners and timers to prevent memory leaks
  - Added comprehensive timeout hierarchy documentation

## 0.13.3

### Patch Changes

- Fix rate limit wait being aborted by provider timeout (#183)

  Problem: When a rate limit (429) response includes a long retry-after header
  (e.g., 15 hours), the agent would fail with "The operation timed out."
  after only 5 minutes.

  Solution: Use isolated AbortController for rate limit waits that only respects
  the global AGENT_RETRY_TIMEOUT (default 7 days), not provider-level timeouts.

  Key changes:
  - Added createIsolatedRateLimitSignal() for rate limit waits
  - Rate limit waits now periodically check for user cancellation (every 10s)
  - Proper cleanup of event listeners and timers to prevent memory leaks
  - Added comprehensive timeout hierarchy documentation

  Fixes #183

## 0.13.2

### Patch Changes

- a58734d: Fix ProviderModelNotFoundError for newly added models like kimi-k2.5-free

  When the models.dev cache was missing or stale, the refresh() call was not awaited,
  causing the agent to use outdated/empty cache data. This led to ProviderModelNotFoundError
  for models that exist in the remote API but weren't in the local cache.

  The fix ensures that:
  - When no cache exists (first run): await refresh() before proceeding
  - When cache is stale (> 1 hour old): await refresh() to get updated model list
  - When cache is fresh: trigger background refresh but use cached data immediately

  Fixes #175

## 0.13.1

### Patch Changes

- 198d941: Fix indefinite hang when using Kilo provider by adding timeout to BunProc.run (#173)
  - Add DEFAULT_TIMEOUT_MS (2 minutes) for subprocess commands
  - Add INSTALL_TIMEOUT_MS (60 seconds) for package installation
  - Create TimeoutError for better error handling and retry logic
  - Add retry logic for timeout errors (up to 3 attempts)
  - Add helpful error messages for timeout and recovery scenarios

  This prevents indefinite hangs caused by known Bun package manager issues:
  - HTTP 304 response handling (oven-sh/bun#5831)
  - Failed dependency fetch (oven-sh/bun#26341)
  - IPv6 configuration issues

## 0.13.0

### Minor Changes

- aa9e354: Fix Kilo provider integration: correct API endpoint, SDK, model IDs, and add device auth support (#171)
  - Fix base URL from /api/gateway to /api/openrouter
  - Switch SDK from @ai-sdk/openai-compatible to @openrouter/ai-sdk-provider
  - Fix all model ID mappings to match actual Kilo API identifiers
  - Add Kilo device auth plugin for `agent auth login`
  - Add required Kilo headers (User-Agent, X-KILOCODE-EDITORNAME)

## 0.12.3

### Patch Changes

- c7a5154: fix: Skip malformed SSE events instead of crashing (AI_JSONParseError)

  When AI gateways (e.g. OpenCode Zen) corrupt SSE stream chunks when proxying
  provider responses (e.g. Kimi K2.5), the Vercel AI SDK emits an error event
  with AI_JSONParseError but continues the stream. Previously, the processor
  threw on all error events, terminating the session.

  Now, following the OpenAI Codex approach (skip-and-continue), the processor
  detects JSONParseError in stream error events, logs a warning, and continues
  processing subsequent valid chunks. This prevents a single corrupted SSE event
  from terminating an entire session.
  - Skip JSONParseError in processor.ts stream error handler (Codex approach)
  - Remove StreamParseError retry infrastructure (skip, don't retry)
  - Add case study with comparison of 4 CLI agents (Codex, Gemini, Qwen, OpenCode)
  - Filed upstream issues: vercel/ai#12595, anomalyco/opencode#13579

  Fixes #169

## 0.12.2

### Patch Changes

- fix: Retry on stream parse errors (AI_JSONParseError)

  Add StreamParseError as a retryable error type to handle malformed JSON in SSE streams
  from AI providers. This fixes premature retry failures when providers return corrupted
  streaming responses (e.g., concatenated SSE chunks, invalid JSON).

  Changes:
  - Add StreamParseError type with isRetryable: true
  - Detect AI_JSONParseError, JSON parsing failures, and malformed JSON errors
  - Retry stream parse errors with exponential backoff (1s, 2s, 4s up to 3 retries)
  - Add streamParseErrorDelay() function for consistent retry timing
  - Add comprehensive test coverage for StreamParseError detection

  This ensures the agent's 7-day retry window works for all transient errors,
  not just HTTP 429 rate limits and socket errors.

  Fixes #169

## 0.12.1

### Patch Changes

- 9b072ca: Fix explicit provider/model routing for Kilo provider

  When users specify an explicit provider/model combination like `kilo/glm-5-free`, the system now correctly uses that provider instead of silently falling back to the default (opencode).
  - Add resolveShortModelName() to route short model names to providers
  - Add parseModelWithResolution() for model string parsing with resolution
  - Modify prompt.ts to throw error instead of falling back on explicit provider
  - Add getAlternativeProviders() for rate limit fallback on shared models
  - Document free model distribution between OpenCode and Kilo

- ed7f9fc: fix: Time-based retry for rate limits at fetch level

  Implement custom fetch wrapper to handle HTTP 429 (rate limit) responses at the HTTP layer,
  ensuring the agent's time-based retry configuration is respected instead of the AI SDK's
  fixed retry count (3 attempts).

  Changes:
  - Add RetryFetch wrapper that intercepts 429 responses before AI SDK's internal retry
  - Parse retry-after and retry-after-ms headers from server responses
  - Use exponential backoff when no header is present (up to 20 minutes per retry)
  - Respect AGENT_RETRY_TIMEOUT (default: 7 weeks) as global timeout
  - Add AGENT_MIN_RETRY_INTERVAL (default: 30 seconds) to prevent rapid retry attempts
  - Retry network errors (socket/connection issues) with exponential backoff
  - Compose with existing custom fetch functions (OAuth, timeout wrappers)

  This fixes the issue where the AI SDK exhausted its 3 retry attempts before the agent's
  retry logic could wait for the server's retry-after period (e.g., 64 minutes).

  Fixes #167

## 0.12.0

### Minor Changes

- 89e466d: Add Kilo Gateway provider with free models support
  - Add Kilo Gateway provider with 6 free models (GLM-5, GLM 4.7, Kimi K2.5, MiniMax M2.1, Giga Potato, Trinity Large Preview)
  - GLM-5 is the flagship free model with 202K context window
  - OpenAI-compatible API at https://api.kilo.ai/api/gateway
  - No API key required for free models
  - Add comprehensive documentation for Kilo Gateway usage

## 0.11.0

### Minor Changes

- f47d0b2: Add --generate-title flag and enhanced retry logic with exponential backoff
  - Add `--generate-title` CLI option (disabled by default) to save tokens on title generation
  - Implement retry with exponential backoff up to 20 minutes per retry, 7 days total timeout
  - Add `--retry-timeout` option to configure maximum retry duration (default: 7 days)
  - Respect retry-after headers from API responses
  - Add jitter to prevent thundering herd on retries
  - Track retry state per error type (different errors reset the timer)

## 0.10.2

### Patch Changes

- feat: Add --generate-title flag to control session title generation (disabled by default)

  Session title generation is now disabled by default to save tokens and prevent rate limit
  issues when using free tier models. Enable it with the --generate-title CLI flag or
  AGENT_GENERATE_TITLE=true environment variable.

  See: https://github.com/link-assistant/agent/issues/157

- feat: Enhanced retry logic with configurable timeout and retry-after header support

  Improved rate limit handling with:
  - Respect retry-after headers from API providers (capped to 20 min max per retry)
  - Configurable total retry timeout via --retry-timeout or AGENT_RETRY_TIMEOUT (default: 7 days)
  - Configurable max single retry delay via AGENT_MAX_RETRY_DELAY (default: 20 minutes)
  - Added jitter to prevent thundering herd when multiple requests retry
  - Retry state tracking per session with automatic reset on different error types

  See: https://github.com/link-assistant/agent/issues/157

## 0.10.0

### Minor Changes

- 77d80f7: Add Qwen Coder OAuth subscription support
  - Add QwenPlugin and AlibabaPlugin to auth plugins with OAuth device flow
  - Support Qwen Coder subscription via OAuth (device flow) with free tier
  - Add token refresh support for automatic credential renewal
  - Add custom provider loaders for qwen-coder and alibaba in provider.ts
  - Both "Qwen Coder" and "Alibaba" menu items available in auth login

### Patch Changes

- 7ffcf71: fix: display CLI help text on stdout instead of stderr

  When running `agent auth` without a subcommand, the help text was displayed
  on stderr, causing it to appear in red in many terminals. Help text is
  informational and should go to stdout, following the industry standard
  behavior of CLI tools like git, gh, and npm.

## 0.9.0

### Minor Changes

- feat(google): Improve Google AI subscription support via Cloud Code API

  Implements proper Google AI subscription authentication with the following improvements:
  - Add user onboarding flow (loadCodeAssist + onboardUser) for automatic tier provisioning
  - Add alt=sse query parameter for streaming requests (matching Gemini CLI behavior)
  - Add thoughtSignature injection for Gemini 3+ function calls to prevent 400 errors
  - Add retry logic with exponential backoff for transient 429/503 errors
  - Add project context caching to avoid repeated onboarding API calls
  - Support configurable Cloud Code API endpoint via CODE_ASSIST_ENDPOINT env var
  - Use dynamic package version in x-goog-api-client header
  - Add comprehensive case study analysis for issue #102

  These changes align the implementation with the official Gemini CLI and opencode-gemini-auth plugin,
  enabling reliable subscription-based access without requiring API keys.

## 0.8.22

### Patch Changes

- a40b7fa: Changed default model from opencode/gpt-5-nano to opencode/kimi-k2.5-free

  Updated free models list in order of recommendation:
  1. kimi-k2.5-free (best recommended - new default)
  2. minimax-m2.1-free
  3. gpt-5-nano
  4. glm-4.7-free
  5. big-pickle

  Added deprecation warning for grok-code model which is no longer included as a free model in OpenCode Zen subscription.

## 0.8.21

### Patch Changes

- 06a17f0: fix: make toModelMessage async for AI SDK 6.0 compatibility

  The AI SDK 6.0 changed convertToModelMessages() from synchronous to asynchronous,
  which caused "Spread syntax requires ...iterable[Symbol.iterator] to be a function"
  errors when spreading the result.

  Changes:
  - Make MessageV2.toModelMessage async and await convertToModelMessages
  - Update all callers in prompt.ts, compaction.ts, summary.ts to await

  Fixes #155

## 0.8.20

### Patch Changes

- d03e32f: Fix process name to show as 'agent' instead of 'bun' in top/ps using platform-specific system calls

  The previous fix using process.title/process.argv0 did not work in Bun because Bun does not implement the process.title setter. This fix uses Bun's FFI to call prctl(PR_SET_NAME) on Linux and pthread_setname_np on macOS, which correctly sets the kernel-level process name visible in top, ps, and htop.

## 0.8.19

### Patch Changes

- 5ce1b0a: Fix crash when providers return undefined usage data. Handle AI SDK TypeError for input_tokens gracefully and upgrade AI SDK to v6.0.1 which includes upstream fix. Also ensure unhandled rejections exit with code 1 instead of code 0.

## 0.8.18

### Patch Changes

- 27834ef: Improve ProviderModelNotFoundError with helpful suggestions for OpenRouter models when provider is not found

## 0.8.17

### Patch Changes

- c0b2032: Fix ZodError in session processor when tool execution fails
  - Change tool error status from 'failed' to 'error' in processor.ts to match ToolStateError Zod schema
  - Fix cleanup loop to use 'error' status consistently with the discriminated union definition
  - Update event-handler.js to check for 'error' status instead of 'failed'
  - Add case study analysis for issue #149 documenting root cause and fix

## 0.8.16

### Patch Changes

- dc1d090: Improve installation instructions with step-by-step guide and troubleshooting
  - Add numbered step-by-step installation instructions for JavaScript/Bun version
  - Add explicit `source ~/.bashrc` step to reload shell configuration after Bun installation
  - Add verification commands (`bun --version`, `agent --version`) to confirm successful installation
  - Add comprehensive troubleshooting section covering common installation issues
  - Add Rust installation prerequisites and verification steps
  - Add case study documentation analyzing installation UX improvements (issue #136)

## 0.8.15

### Patch Changes

- 10b2888: Add stream timeout to prevent agent CLI from hanging indefinitely when LLM API connections stall. Configurable via AGENT_STREAM_CHUNK_TIMEOUT_MS (default: 2min) and AGENT_STREAM_STEP_TIMEOUT_MS (default: 10min) environment variables.

## 0.8.14

### Patch Changes

- 5a9f0de: Fix process name to show as 'agent' instead of 'bun' in process monitoring tools

  This change sets both process.title and process.argv0 to 'agent' at CLI startup,
  ensuring the process appears as 'agent' instead of 'bun' in monitoring tools like top and ps.

## 0.8.13

### Patch Changes

- 7cff63f: Add automatic retry for timeout errors with 30s, 60s, 120s intervals

  Previously, when an API request timed out (DOMException TimeoutError from AbortSignal.timeout()),
  the agent would fail immediately. Now, timeout errors are automatically retried up to 3 times
  with increasing delays of 30, 60, and 120 seconds.

  This handles all retryable HTTP statuses (408, 409, 429, 500+) via existing APIError retry logic,
  plus the new TimeoutError for connection-level timeouts.

## 0.8.11

### Patch Changes

- f5513da: Add OpenRouter documentation guide with detailed configuration instructions
- 7dc074b: Add uninstallation instructions to README
  - Add instructions for removing the agent package (global and local)
  - Add instructions for completely removing Bun from the system
  - Include information about cleaning up shell configuration files

## 0.8.10

### Patch Changes

- 7748404: Fix CLI output streams to follow Unix conventions
  - Route normal output (status, events, data, logs, warnings) to stdout
  - Route error messages only to stderr
  - Add `type` field to all JSON output for easy parsing
  - Support `--compact-json` flag and `AGENT_CLI_COMPACT` env var for NDJSON format
  - Flatten log format from `{ "log": { ... } }` to `{ "type": "log", ... }`

## 0.8.9

### Patch Changes

- 6029187: Handle AI SDK unified/raw format in toFinishReason
  - Added handling for `unified` field in `toFinishReason()` function
  - AI SDK may return finishReason as `{unified: "tool-calls", raw: "tool_calls"}`
  - Previously this caused JSON.stringify fallback, breaking loop exit condition
  - Agent now correctly continues processing after tool calls

  Fixes #129

## 0.8.7

### Patch Changes

- c92e114: Fix toNumber returning NaN for undefined values and extract nested cache/reasoning tokens
  - Changed `toNumber()` to return 0 instead of NaN for undefined/null inputs (issue #127)
  - This fixes alarming debug logs like "toNumber error - returning NaN" for optional fields
  - Added extraction of `cacheRead` from nested `inputTokens` object
  - Added extraction of `reasoning` from nested `outputTokens` object
  - This enables proper token tracking for providers like `opencode/grok-code` that nest these values

## 0.8.6

### Patch Changes

- 8ef7cfa: Handle object types for token counts and finishReason
  - Enhanced `toNumber()` to extract `total` from objects with that field
  - Added `toFinishReason()` to safely convert object/string finishReason values to string
  - Updated `processor.ts` to use the new `toFinishReason()` function
  - Fixes ZodError crashes on Ubuntu with newer Bun versions (1.3.6+)

  Fixes #125

## 0.8.5

### Patch Changes

- d5bbb18: Fix shields.io badge URL in GitHub release notes
  - Fixed badge URL generation that was broken by tag prefixes (js-, rust-)
  - The `format-github-release.mjs` script now passes `v${version}` instead of the full tag
  - This ensures the badge URL contains only the version number (e.g., `0.8.4`) without prefix
  - See `docs/case-studies/issue-123` for detailed root cause analysis

  Fixes #123

## 0.8.4

### Patch Changes

- afcd2f8: Fix GitHub release style to match template repository standards
  - Fix release name format to use `[js]` prefix instead of `js ` (e.g., `[js] 0.8.4` instead of `js 0.8.4`)
  - Fix changelog path for js releases to use `js/CHANGELOG.md` instead of root `CHANGELOG.md`
  - This ensures release descriptions contain actual changelog content with PR links and npm badges

  Fixes #121

## 0.8.3

### Patch Changes

- e869df7: Fix DecimalError crash in getUsage() when token data contains objects
  - Add safe() wrapper function to sanitize numeric inputs before Decimal.js
  - Wrap all token calculations with safe() to handle NaN, Infinity, and objects
  - Add try-catch around cost calculation as additional safety measure
  - Add comprehensive unit tests for edge cases

  Fixes #119

## 0.8.2

### Patch Changes

- 4146833: Add language-specific README.md files for JavaScript and Rust implementations
  - Create js/README.md with npm-specific documentation (installation, development, publishing)
  - Create rust/README.md with cargo-specific documentation (build, features, status)
  - Update root README.md to serve as common entry point for both implementations
  - Update package.json files array to include js/README.md for npm package

## 0.8.1

### Patch Changes

- 4f4e6e7: Add publish verification and failure detection to prevent false positives

  The npm publish script now detects failures even when changeset publish exits with code 0. This prevents the CI from falsely reporting success when packages fail to publish.

## 0.8.0

### Minor Changes

- bdb2446: feat: Add Rust CLI implementation with JavaScript reorganization
  - Reorganized JavaScript files from src/ to js/src/ for clearer project structure
  - Moved all JS config files to js/ folder for complete isolation
  - Created separate CI/CD pipelines (js.yml and rust.yml)
  - Created complete Rust implementation of the agent CLI in rust/ folder
  - Added rust/changelog.d/ for Rust changelog fragments
  - Documented lessons learned in docs/case-studies/issue-104/
