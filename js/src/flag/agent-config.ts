/**
 * Centralized agent configuration using lino-arguments.
 *
 * All environment variables are resolved in a single place using getenv()
 * from lino-arguments, which handles case-insensitive env var lookups,
 * .lenv file support, and type-preserving defaults.
 *
 * The configuration is initialized once at startup after yargs parsing,
 * merging CLI args (from yargs) and env vars (from getenv) in one place.
 *
 * This module is the single source of truth for all agent configuration.
 * See: https://github.com/link-foundation/lino-arguments
 * See: https://github.com/link-assistant/agent/issues/227
 */
import { getenv } from 'lino-arguments';

/**
 * Resolved agent configuration.
 * null until init() is called.
 */
let resolvedConfig: AgentConfig | null = null;

export interface AgentConfig {
  verbose: boolean;
  dryRun: boolean;
  generateTitle: boolean;
  outputResponseModel: boolean;
  summarizeSession: boolean;
  retryOnRateLimits: boolean;
  compactJson: boolean;
  config: string;
  configDir: string;
  configContent: string;
  disableAutoupdate: boolean;
  disablePrune: boolean;
  enableExperimentalModels: boolean;
  disableAutocompact: boolean;
  experimental: boolean;
  experimentalWatcher: boolean;
  retryTimeout: number;
  maxRetryDelay: number;
  minRetryInterval: number;
  streamChunkTimeoutMs: number;
  streamStepTimeoutMs: number;
  mcpDefaultToolCallTimeout: number;
  mcpMaxToolCallTimeout: number;
  verifyImagesAtReadTool: boolean;
}

/**
 * Initialize the centralized agent configuration from CLI args and env vars.
 *
 * Uses getenv() from lino-arguments for env var resolution, which provides:
 * - Case-insensitive lookups (tries UPPER_CASE, camelCase, kebab-case, etc.)
 * - Type-preserving defaults (boolean, number, string)
 * - .lenv file support (loaded automatically)
 *
 * CLI args (from yargs) take priority over env vars.
 *
 * @param argv - Parsed yargs argv object. Pass undefined to use env-only defaults.
 */
export function initAgentConfig(argv?: Record<string, unknown>): AgentConfig {
  // Resolve all config values from env vars using getenv (lino-arguments).
  // CLI args from yargs override env var defaults when provided.
  resolvedConfig = {
    verbose:
      (argv?.verbose as boolean) ??
      getenv('LINK_ASSISTANT_AGENT_VERBOSE', false),
    dryRun:
      (argv?.['dry-run'] as boolean) ??
      getenv('LINK_ASSISTANT_AGENT_DRY_RUN', false),
    generateTitle:
      (argv?.['generate-title'] as boolean) ??
      getenv('LINK_ASSISTANT_AGENT_GENERATE_TITLE', false),
    outputResponseModel:
      (argv?.['output-response-model'] as boolean) ??
      getenv('LINK_ASSISTANT_AGENT_OUTPUT_RESPONSE_MODEL', true),
    summarizeSession:
      (argv?.['summarize-session'] as boolean) ??
      getenv('LINK_ASSISTANT_AGENT_SUMMARIZE_SESSION', true),
    retryOnRateLimits: (argv?.['retry-on-rate-limits'] as boolean) ?? true,
    compactJson:
      (argv?.['compact-json'] as boolean) ??
      getenv('LINK_ASSISTANT_AGENT_COMPACT_JSON', false),
    // Env-only options (not exposed as CLI flags)
    config: getenv('LINK_ASSISTANT_AGENT_CONFIG', ''),
    configDir: getenv('LINK_ASSISTANT_AGENT_CONFIG_DIR', ''),
    configContent: getenv('LINK_ASSISTANT_AGENT_CONFIG_CONTENT', ''),
    disableAutoupdate: getenv('LINK_ASSISTANT_AGENT_DISABLE_AUTOUPDATE', false),
    disablePrune: getenv('LINK_ASSISTANT_AGENT_DISABLE_PRUNE', false),
    enableExperimentalModels: getenv(
      'LINK_ASSISTANT_AGENT_ENABLE_EXPERIMENTAL_MODELS',
      false
    ),
    disableAutocompact: getenv(
      'LINK_ASSISTANT_AGENT_DISABLE_AUTOCOMPACT',
      false
    ),
    experimental: getenv('LINK_ASSISTANT_AGENT_EXPERIMENTAL', false),
    experimentalWatcher:
      getenv('LINK_ASSISTANT_AGENT_EXPERIMENTAL', false) ||
      getenv('LINK_ASSISTANT_AGENT_EXPERIMENTAL_WATCHER', false),
    retryTimeout: getenv('LINK_ASSISTANT_AGENT_RETRY_TIMEOUT', 604800),
    maxRetryDelay: getenv('LINK_ASSISTANT_AGENT_MAX_RETRY_DELAY', 1200),
    minRetryInterval: getenv('LINK_ASSISTANT_AGENT_MIN_RETRY_INTERVAL', 30),
    streamChunkTimeoutMs: getenv(
      'LINK_ASSISTANT_AGENT_STREAM_CHUNK_TIMEOUT_MS',
      120000
    ),
    streamStepTimeoutMs: getenv(
      'LINK_ASSISTANT_AGENT_STREAM_STEP_TIMEOUT_MS',
      600000
    ),
    mcpDefaultToolCallTimeout: getenv(
      'LINK_ASSISTANT_AGENT_MCP_DEFAULT_TOOL_CALL_TIMEOUT',
      120000
    ),
    mcpMaxToolCallTimeout: getenv(
      'LINK_ASSISTANT_AGENT_MCP_MAX_TOOL_CALL_TIMEOUT',
      600000
    ),
    verifyImagesAtReadTool: getenv(
      'LINK_ASSISTANT_AGENT_VERIFY_IMAGES_AT_READ_TOOL',
      true
    ),
  };

  // Propagate verbose to env var for subprocess resilience.
  // This is the critical fix for issue #227: ensures --verbose survives
  // across subprocess spawning and module re-evaluation.
  if (resolvedConfig.verbose) {
    process.env.LINK_ASSISTANT_AGENT_VERBOSE = 'true';
  }

  return resolvedConfig;
}

/**
 * Get the resolved agent configuration.
 * Throws if init() has not been called yet.
 */
export function getAgentConfig(): AgentConfig {
  if (!resolvedConfig) {
    throw new Error(
      'AgentConfig not initialized. Call initAgentConfig() first.'
    );
  }
  return resolvedConfig;
}

/**
 * Check if agent config has been initialized.
 */
export function isAgentConfigInitialized(): boolean {
  return resolvedConfig !== null;
}

/**
 * Update a specific config value at runtime.
 * Used by Flag setters (e.g., setVerbose) that need to change config after init.
 */
export function updateAgentConfig(updates: Partial<AgentConfig>): AgentConfig {
  if (!resolvedConfig) {
    throw new Error(
      'AgentConfig not initialized. Call initAgentConfig() first.'
    );
  }
  Object.assign(resolvedConfig, updates);

  // Sync verbose to env var when updated
  if ('verbose' in updates) {
    if (updates.verbose) {
      process.env.LINK_ASSISTANT_AGENT_VERBOSE = 'true';
    } else {
      delete process.env.LINK_ASSISTANT_AGENT_VERBOSE;
    }
  }

  return resolvedConfig;
}

/**
 * Reset config (for testing only).
 */
export function resetAgentConfig(): void {
  resolvedConfig = null;
}

/**
 * Get a plain JSON-serializable snapshot of the resolved config.
 * Used for logging the configuration at startup.
 */
export function getAgentConfigSnapshot(): Record<string, unknown> {
  if (!resolvedConfig) {
    return { initialized: false };
  }
  // Return a clean copy, omitting empty strings for readability
  const snapshot: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(resolvedConfig)) {
    if (value !== '' && value !== undefined) {
      snapshot[key] = value;
    }
  }
  return snapshot;
}
