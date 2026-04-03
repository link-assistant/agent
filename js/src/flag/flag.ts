export namespace Flag {
  // Helper to check env vars with new prefix first, then fall back to old prefix for backwards compatibility
  function getEnv(newKey: string, oldKey: string): string | undefined {
    return process.env[newKey] ?? process.env[oldKey];
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

  // Output response model information in step-finish parts
  // Enabled by default - includes model info (providerID, requestedModelID, respondedModelID) in output
  // Can be disabled with AGENT_OUTPUT_RESPONSE_MODEL=false
  // See: https://github.com/link-assistant/agent/issues/179
  export let OUTPUT_RESPONSE_MODEL = (() => {
    const value = (
      getEnv(
        'LINK_ASSISTANT_AGENT_OUTPUT_RESPONSE_MODEL',
        'AGENT_OUTPUT_RESPONSE_MODEL'
      ) ?? ''
    ).toLowerCase();
    if (value === 'false' || value === '0') return false;
    return true; // Default to true
  })();

  // Allow setting output-response-model mode programmatically (e.g., from CLI --output-response-model flag)
  export function setOutputResponseModel(value: boolean) {
    OUTPUT_RESPONSE_MODEL = value;
  }

  // Session summarization configuration
  // Enabled by default - generates AI-powered session summaries using the same model
  // Can be disabled with --no-summarize-session or AGENT_SUMMARIZE_SESSION=false
  // See: https://github.com/link-assistant/agent/issues/217
  export let SUMMARIZE_SESSION = (() => {
    const value = (
      getEnv(
        'LINK_ASSISTANT_AGENT_SUMMARIZE_SESSION',
        'AGENT_SUMMARIZE_SESSION'
      ) ?? ''
    ).toLowerCase();
    if (value === 'false' || value === '0') return false;
    return true; // Default to true
  })();

  // Allow setting summarize-session mode programmatically (e.g., from CLI --summarize-session flag)
  export function setSummarizeSession(value: boolean) {
    SUMMARIZE_SESSION = value;
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
  // Also sets the environment variable so the flag survives across module re-evaluations
  // and is inherited by child processes. This is critical for --verbose to work reliably
  // when the agent CLI is spawned by external tools (e.g., command-stream, solve).
  // See: https://github.com/link-assistant/agent/issues/227
  export function setVerbose(value: boolean) {
    OPENCODE_VERBOSE = value;
    if (value) {
      process.env.LINK_ASSISTANT_AGENT_VERBOSE = 'true';
    } else {
      delete process.env.LINK_ASSISTANT_AGENT_VERBOSE;
    }
  }

  /**
   * Check if verbose mode is active, with env var fallback.
   * This function checks both the in-memory flag AND the environment variable,
   * providing resilience against module re-evaluation or flag state loss.
   * See: https://github.com/link-assistant/agent/issues/227
   */
  export function isVerbose(): boolean {
    return (
      OPENCODE_VERBOSE ||
      truthyCompat('LINK_ASSISTANT_AGENT_VERBOSE', 'OPENCODE_VERBOSE')
    );
  }

  // Allow setting dry run mode programmatically (e.g., from CLI --dry-run flag)
  export function setDryRun(value: boolean) {
    OPENCODE_DRY_RUN = value;
  }

  // Allow setting compact JSON mode programmatically (e.g., from CLI --compact-json flag)
  export function setCompactJson(value: boolean) {
    _compactJson = value;
  }

  // Retry on rate limits - when disabled, 429 responses are returned immediately without retrying
  // Enabled by default. Use --no-retry-on-rate-limits in integration tests to avoid waiting for rate limits.
  export let RETRY_ON_RATE_LIMITS = true;

  // Allow setting retry-on-rate-limits mode programmatically (e.g., from CLI --retry-on-rate-limits flag)
  export function setRetryOnRateLimits(value: boolean) {
    RETRY_ON_RATE_LIMITS = value;
  }
}
