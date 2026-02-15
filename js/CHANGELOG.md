# @link-assistant/agent

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
