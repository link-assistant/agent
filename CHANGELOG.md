# Changelog

## 0.1.3

### Patch Changes

- 50728b3: fix: Fixed `agent --version` command and added logging in `--verbose` mode
  - Fixed `--version` command that was showing "unknown" instead of the current package version
  - Added explicit import of `package.json` using `createRequire` with fallback via `fs`
  - Added logging of version, command, working directory and script path in `--verbose` mode

## 0.1.2

### Patch Changes

- de95398: fix: Pass API key to providers with multiple env var options

  Fixes #61 - Error when using google/gemini-3-pro model. When providers have multiple possible environment variables (like Google with GOOGLE_GENERATIVE_AI_API_KEY and GEMINI_API_KEY), the code was finding the API key correctly but then not passing it to mergeProvider.

## 0.1.1

### Patch Changes

- 09b6709: Fix GitHub release formatting to remove incorrect title for major/minor/patch versions and properly link related pull requests

## 0.1.0

### Minor Changes

- 2bcef5f: Add support for google/gemini-3-pro model alias
  - Added `google/gemini-3-pro` as an alias to `gemini-3-pro-preview`
  - Updated README.md with Google Gemini usage examples
  - Created comprehensive case study in docs/case-studies/issue-53/
  - Fixes ProviderModelNotFoundError when using google/gemini-3-pro

  This change allows users to use the commonly expected model name `gemini-3-pro` while maintaining compatibility with Google's official `gemini-3-pro-preview` identifier.

### Patch Changes

- 86f24ac: Add comprehensive image validation to prevent API errors
  - Added magic byte validation for PNG, JPEG/JPG, GIF, BMP, WebP, TIFF, SVG, ICO, and AVIF formats
  - Prevents "Could not process image" API errors from invalid files
  - Added `VERIFY_IMAGES_AT_READ_TOOL` environment variable for opt-out (enabled by default)
  - Enhanced error messages with hex dump debugging information
  - Comprehensive test suite with 6+ test cases
  - Fixes #38 and prevents session crashes from corrupted image files

## 0.0.17

### Patch Changes

- 8d3c137: Fix empty string system message override. When --system-message "" is provided, the system now correctly overrides with an empty string instead of falling back to the default system prompt. This was caused by a falsy check (if (input.system)) that evaluated to false for empty strings. Changed to explicit undefined check (if (input.system !== undefined)) to properly distinguish between undefined (use default) and empty string (override with empty).

## 0.0.16

### Patch Changes

- 1ace1a9: Add comprehensive Playwright MCP installation instructions to README.md. This includes step-by-step setup guide, complete list of available browser automation tools, usage examples, and links to official documentation. Fixes issue #54.

## 0.0.15

### Patch Changes

- 3a5fad7: Fix debug output appearing in CLI commands - logs are now suppressed by default and only shown with --verbose flag. This fixes the issue where commands like `agent auth list` displayed debug messages that broke the clean CLI UI.

## 0.0.14

### Patch Changes

- 07aef38: fix: Use valid placeholder API keys for OAuth providers (Anthropic, GitHub Copilot, OpenAI)

  When using `--model anthropic/claude-sonnet-4-5` after authenticating with `agent auth login` (Anthropic > Claude Pro/Max), the command failed with `ProviderInitError` at line 732 in `src/provider/provider.ts`.

  The OAuth authentication plugin loaders in `src/auth/plugins.ts` were returning empty strings (`''`) for the `apiKey` parameter. The AI SDK providers (e.g., `@ai-sdk/anthropic`, `@ai-sdk/openai`) require a non-empty `apiKey` parameter even when using custom fetch functions for authentication. The empty string failed validation, causing provider initialization to fail.

  This fix changes the `apiKey` value from an empty string to a descriptive placeholder string (`'oauth-token-used-via-custom-fetch'`) for all OAuth loaders (AnthropicPlugin, GitHubCopilotPlugin, and OpenAIPlugin). The placeholder satisfies AI SDK validation requirements while the actual OAuth authentication happens via Bearer tokens in the custom fetch's Authorization header.

  Fixes #47

## 0.0.13

### Patch Changes

- 4b4c0ea: Fix ESC key handling in CLI commands - pressing ESC now exits gracefully without showing error messages or help text

## 0.0.12

### Patch Changes

- c022218: fix: Replace prompts.autocomplete with prompts.select in auth login command

  The `agent auth login` command was failing with `TypeError: prompts.autocomplete is not a function` because `@clack/prompts@0.11.0` does not have the `autocomplete` function (it was added in v1.0.0-alpha.0).

  This fix replaces `prompts.autocomplete()` with `prompts.select()` which is available in the stable version.

  Fixes #43

## 0.0.11

### Patch Changes

- e8e2d03: Fix system message override to use exclusively without additional context for low-limit models. When --system-message flag is provided, the system now returns only that message without adding environment info, custom instructions, or headers. This reduces token usage from ~9,059 to ~30 tokens, enabling support for models with low TPM limits like groq/qwen/qwen3-32b (6K TPM).

  Also adds --verbose mode to debug API requests with system prompt content and token estimates.

## 0.0.10

### Patch Changes

- 547d73f: Add CI/CD pipeline matching js-ai-driven-development-pipeline-template with changeset support, automated npm publishing, and code quality tools (ESLint, Prettier, Husky)

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
