# @link-assistant/agent

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
