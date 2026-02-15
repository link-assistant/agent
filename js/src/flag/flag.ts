export namespace Flag {
  // Helper to check env vars with new prefix first, then fall back to old prefix for backwards compatibility
  function getEnv(newKey: string, oldKey: string): string | undefined {
    return process.env[newKey] ?? process.env[oldKey];
  }

  /**
   * Suppress AI SDK warnings by default to avoid noise in CLI output.
   *
   * The AI SDK logs warnings to console for:
   * - specificationVersion v2 compatibility mode (when using @ai-sdk/openai-compatible)
   * - Model version mismatches
   *
   * These warnings are expected when using the OpenAI-compatible provider with AI SDK 6.x
   * since the provider still implements v2 specification.
   *
   * Users can re-enable warnings by setting:
   * - AGENT_ENABLE_AI_SDK_WARNINGS=true or 1
   * - AI_SDK_LOG_WARNINGS=true (native AI SDK flag)
   *
   * @see https://github.com/link-assistant/agent/issues/177
   * @see https://github.com/vercel/ai/issues/12615
   */
  export function initAISDKWarnings(): void {
    // Check if user explicitly wants AI SDK warnings
    const enableWarnings = truthy('AGENT_ENABLE_AI_SDK_WARNINGS');

    // Suppress AI SDK warnings unless explicitly enabled
    // The globalThis.AI_SDK_LOG_WARNINGS flag is checked by the AI SDK before logging warnings
    if (!enableWarnings && (globalThis as any).AI_SDK_LOG_WARNINGS === undefined) {
      (globalThis as any).AI_SDK_LOG_WARNINGS = false;
    }
  }

  function truthy(key: string) {
    const value = process.env[key]?.toLowerCase();
    return value === 'true' || value === '1';
  }

  function truthyCompat(newKey: string, oldKey: string): boolean {
    const value = (getEnv(newKey, oldKey) ?? '').toLowerCase();
    return value === 'true' || value === '1';
  }

  // LINK_ASSISTANT_AGENT_AUTO_SHARE removed - no sharing support
  export const OPENCODE_CONFIG = getEnv(
    'LINK_ASSISTANT_AGENT_CONFIG',
    'OPENCODE_CONFIG'
  );
  export const OPENCODE_CONFIG_DIR = getEnv(
    'LINK_ASSISTANT_AGENT_CONFIG_DIR',
    'OPENCODE_CONFIG_DIR'
  );
  export const OPENCODE_CONFIG_CONTENT = getEnv(
    'LINK_ASSISTANT_AGENT_CONFIG_CONTENT',
    'OPENCODE_CONFIG_CONTENT'
  );
  export const OPENCODE_DISABLE_AUTOUPDATE = truthyCompat(
    'LINK_ASSISTANT_AGENT_DISABLE_AUTOUPDATE',
    'OPENCODE_DISABLE_AUTOUPDATE'
  );
  export const OPENCODE_DISABLE_PRUNE = truthyCompat(
    'LINK_ASSISTANT_AGENT_DISABLE_PRUNE',
    'OPENCODE_DISABLE_PRUNE'
  );
  export const OPENCODE_ENABLE_EXPERIMENTAL_MODELS = truthyCompat(
    'LINK_ASSISTANT_AGENT_ENABLE_EXPERIMENTAL_MODELS',
    'OPENCODE_ENABLE_EXPERIMENTAL_MODELS'
  );
  export const OPENCODE_DISABLE_AUTOCOMPACT = truthyCompat(
    'LINK_ASSISTANT_AGENT_DISABLE_AUTOCOMPACT',
    'OPENCODE_DISABLE_AUTOCOMPACT'
  );

  // Experimental
  export const OPENCODE_EXPERIMENTAL = truthyCompat(
    'LINK_ASSISTANT_AGENT_EXPERIMENTAL',
    'OPENCODE_EXPERIMENTAL'
  );
  export const OPENCODE_EXPERIMENTAL_WATCHER =
    OPENCODE_EXPERIMENTAL ||
    truthyCompat(
      'LINK_ASSISTANT_AGENT_EXPERIMENTAL_WATCHER',
      'OPENCODE_EXPERIMENTAL_WATCHER'
    );

  // Verbose mode - enables detailed logging of API requests
  export let OPENCODE_VERBOSE = truthyCompat(
    'LINK_ASSISTANT_AGENT_VERBOSE',
    'OPENCODE_VERBOSE'
  );

  // Dry run mode - simulate operations without making actual API calls or changes
  export let OPENCODE_DRY_RUN = truthyCompat(
    'LINK_ASSISTANT_AGENT_DRY_RUN',
    'OPENCODE_DRY_RUN'
  );

  // Title generation configuration
  // When disabled, sessions will use default "New session - {timestamp}" titles
  // This saves tokens and prevents rate limit issues with free tier models
  // See: https://github.com/link-assistant/agent/issues/157
  export let GENERATE_TITLE = truthyCompat(
    'LINK_ASSISTANT_AGENT_GENERATE_TITLE',
    'AGENT_GENERATE_TITLE'
  );

  // Allow setting title generation mode programmatically (e.g., from CLI --generate-title flag)
  export function setGenerateTitle(value: boolean) {
    GENERATE_TITLE = value;
  }

  // Retry timeout configuration
  // Maximum total time to keep retrying for the same error type (default: 7 days in seconds)
  // For different error types, the timer resets
  // See: https://github.com/link-assistant/agent/issues/157
  export function RETRY_TIMEOUT(): number {
    const val = getEnv(
      'LINK_ASSISTANT_AGENT_RETRY_TIMEOUT',
      'AGENT_RETRY_TIMEOUT'
    );
    return val ? parseInt(val, 10) : 604800; // 7 days in seconds
  }

  // Maximum delay for a single retry attempt (default: 20 minutes in milliseconds)
  export function MAX_RETRY_DELAY(): number {
    const val = getEnv(
      'LINK_ASSISTANT_AGENT_MAX_RETRY_DELAY',
      'AGENT_MAX_RETRY_DELAY'
    );
    return val ? parseInt(val, 10) * 1000 : 1200000; // 20 minutes in ms
  }

  // Minimum retry interval to prevent rapid retries (default: 30 seconds)
  // This ensures we don't hammer the API with rapid retry attempts
  // See: https://github.com/link-assistant/agent/issues/167
  export function MIN_RETRY_INTERVAL(): number {
    const val = getEnv(
      'LINK_ASSISTANT_AGENT_MIN_RETRY_INTERVAL',
      'AGENT_MIN_RETRY_INTERVAL'
    );
    return val ? parseInt(val, 10) * 1000 : 30000; // 30 seconds in ms
  }

  // Stream timeout configuration
  // chunkMs: timeout between stream chunks - detects stalled streams (default: 2 minutes)
  // stepMs: timeout for each individual LLM step (default: 10 minutes)
  export function STREAM_CHUNK_TIMEOUT_MS(): number {
    const val = getEnv(
      'LINK_ASSISTANT_AGENT_STREAM_CHUNK_TIMEOUT_MS',
      'AGENT_STREAM_CHUNK_TIMEOUT_MS'
    );
    return val ? parseInt(val, 10) : 120_000;
  }

  export function STREAM_STEP_TIMEOUT_MS(): number {
    const val = getEnv(
      'LINK_ASSISTANT_AGENT_STREAM_STEP_TIMEOUT_MS',
      'AGENT_STREAM_STEP_TIMEOUT_MS'
    );
    return val ? parseInt(val, 10) : 600_000;
  }

  // Compact JSON mode - output JSON on single lines (NDJSON format)
  // Enabled by AGENT_CLI_COMPACT env var or --compact-json flag
  // Uses getter to check env var at runtime for tests
  let _compactJson: boolean | null = null;

  export function COMPACT_JSON(): boolean {
    if (_compactJson !== null) return _compactJson;
    return (
      truthy('AGENT_CLI_COMPACT') ||
      truthyCompat('LINK_ASSISTANT_AGENT_COMPACT_JSON', 'OPENCODE_COMPACT_JSON')
    );
  }

  // Allow setting verbose mode programmatically (e.g., from CLI --verbose flag)
  export function setVerbose(value: boolean) {
    OPENCODE_VERBOSE = value;
  }

  // Allow setting dry run mode programmatically (e.g., from CLI --dry-run flag)
  export function setDryRun(value: boolean) {
    OPENCODE_DRY_RUN = value;
  }

  // Allow setting compact JSON mode programmatically (e.g., from CLI --compact-json flag)
  export function setCompactJson(value: boolean) {
    _compactJson = value;
  }

}
