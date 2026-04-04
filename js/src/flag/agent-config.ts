/**
 * Centralized agent configuration using makeConfig from lino-arguments.
 *
 * All configuration is resolved in a single place using makeConfig(),
 * where yargs options and getenv() defaults are defined together.
 * This ensures CLI args, env vars, and .lenv files are merged
 * with a clear priority chain:
 *
 * 1. CLI arguments (--verbose, --dry-run, etc.)
 * 2. Environment variables (LINK_ASSISTANT_AGENT_VERBOSE, etc.)
 * 3. .lenv file values
 * 4. Code defaults
 *
 * This module is the single source of truth for all agent configuration.
 * See: https://github.com/link-foundation/lino-arguments
 * See: https://github.com/link-assistant/agent/issues/227
 */
import { makeConfig, getenv } from 'lino-arguments';

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
 * Build the yargs options for makeConfig.
 * This is the single place where CLI options and env var defaults are defined together.
 * Options defined here are used for both CLI parsing and env var resolution.
 *
 * @param yargs - Yargs instance from makeConfig
 * @param getenv - getenv helper from makeConfig (case-insensitive, type-preserving)
 */
function buildAgentConfigOptions({
  yargs,
  getenv,
}: {
  yargs: any;
  getenv: (key: string, defaultValue: any) => any;
}) {
  return yargs
    .option('verbose', {
      type: 'boolean',
      description: 'Enable verbose mode to debug API requests',
      default: getenv('LINK_ASSISTANT_AGENT_VERBOSE', false),
    })
    .option('dry-run', {
      type: 'boolean',
      description: 'Simulate operations without making actual API calls',
      default: getenv('LINK_ASSISTANT_AGENT_DRY_RUN', false),
    })
    .option('generate-title', {
      type: 'boolean',
      description: 'Generate session titles using AI',
      default: getenv('LINK_ASSISTANT_AGENT_GENERATE_TITLE', false),
    })
    .option('output-response-model', {
      type: 'boolean',
      description: 'Include model info in step_finish output',
      default: getenv('LINK_ASSISTANT_AGENT_OUTPUT_RESPONSE_MODEL', true),
    })
    .option('summarize-session', {
      type: 'boolean',
      description: 'Generate AI session summaries',
      default: getenv('LINK_ASSISTANT_AGENT_SUMMARIZE_SESSION', true),
    })
    .option('retry-on-rate-limits', {
      type: 'boolean',
      description: 'Retry API requests when rate limited (HTTP 429)',
      default: true,
    })
    .option('compact-json', {
      type: 'boolean',
      description:
        'Output compact JSON (single line) instead of pretty-printed',
      default: getenv('LINK_ASSISTANT_AGENT_COMPACT_JSON', false),
    })
    .option('retry-timeout', {
      type: 'number',
      description: 'Maximum total retry time in seconds for rate limit errors',
      default: getenv('LINK_ASSISTANT_AGENT_RETRY_TIMEOUT', 604800),
    })
    .option('max-retry-delay', {
      type: 'number',
      description: 'Maximum delay between retries in seconds',
      default: getenv('LINK_ASSISTANT_AGENT_MAX_RETRY_DELAY', 1200),
    })
    .option('min-retry-interval', {
      type: 'number',
      description: 'Minimum interval between retries in seconds',
      default: getenv('LINK_ASSISTANT_AGENT_MIN_RETRY_INTERVAL', 30),
    })
    .option('stream-chunk-timeout-ms', {
      type: 'number',
      description: 'Timeout for individual stream chunks in milliseconds',
      default: getenv('LINK_ASSISTANT_AGENT_STREAM_CHUNK_TIMEOUT_MS', 120000),
    })
    .option('stream-step-timeout-ms', {
      type: 'number',
      description: 'Timeout for stream steps in milliseconds',
      default: getenv('LINK_ASSISTANT_AGENT_STREAM_STEP_TIMEOUT_MS', 600000),
    })
    .option('mcp-default-tool-call-timeout', {
      type: 'number',
      description: 'Default MCP tool call timeout in milliseconds',
      default: getenv(
        'LINK_ASSISTANT_AGENT_MCP_DEFAULT_TOOL_CALL_TIMEOUT',
        120000
      ),
    })
    .option('mcp-max-tool-call-timeout', {
      type: 'number',
      description: 'Maximum MCP tool call timeout in milliseconds',
      default: getenv('LINK_ASSISTANT_AGENT_MCP_MAX_TOOL_CALL_TIMEOUT', 600000),
    })
    .option('verify-images-at-read-tool', {
      type: 'boolean',
      description: 'Verify images when using the read tool',
      default: getenv('LINK_ASSISTANT_AGENT_VERIFY_IMAGES_AT_READ_TOOL', true),
    });
}

/**
 * Initialize the centralized agent configuration using makeConfig from lino-arguments.
 *
 * Uses makeConfig() which combines yargs and getenv in a single place:
 * - CLI args from process.argv have highest priority
 * - getenv() resolves env vars with case-insensitive lookup
 * - .lenv file values are loaded automatically
 * - Code defaults are used as fallback
 *
 * @param argv - Optional custom argv array to parse (default: process.argv)
 */
export function initAgentConfig(argv?: string[]): AgentConfig {
  // Use makeConfig to resolve all config from CLI args + env vars + .lenv + defaults.
  // The yargs callback defines options with getenv defaults — all in one place.
  const parsed = makeConfig({
    yargs: buildAgentConfigOptions,
    lenv: { enabled: true },
    ...(argv ? { argv } : {}),
  });

  // Resolve env-only options (not exposed as CLI flags) via getenv directly.
  resolvedConfig = {
    verbose: parsed.verbose ?? false,
    dryRun: parsed.dryRun ?? false,
    generateTitle: parsed.generateTitle ?? false,
    outputResponseModel: parsed.outputResponseModel ?? true,
    summarizeSession: parsed.summarizeSession ?? true,
    retryOnRateLimits: parsed.retryOnRateLimits ?? true,
    compactJson: parsed.compactJson ?? false,
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
    retryTimeout: parsed.retryTimeout ?? 604800,
    maxRetryDelay: parsed.maxRetryDelay ?? 1200,
    minRetryInterval: parsed.minRetryInterval ?? 30,
    streamChunkTimeoutMs: parsed.streamChunkTimeoutMs ?? 120000,
    streamStepTimeoutMs: parsed.streamStepTimeoutMs ?? 600000,
    mcpDefaultToolCallTimeout: parsed.mcpDefaultToolCallTimeout ?? 120000,
    mcpMaxToolCallTimeout: parsed.mcpMaxToolCallTimeout ?? 600000,
    verifyImagesAtReadTool: parsed.verifyImagesAtReadTool ?? true,
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
