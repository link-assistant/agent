/**
 * Centralized agent configuration using makeConfig from lino-arguments.
 *
 * This module is the single source of truth for all agent configuration.
 * The globally available `config` variable holds the resolved configuration
 * from makeConfig(), which merges CLI args, env vars, and .lenv files
 * with a clear priority chain:
 *
 * 1. CLI arguments (--verbose, --dry-run, etc.)
 * 2. Environment variables (LINK_ASSISTANT_AGENT_VERBOSE, etc.)
 * 3. .lenv file values
 * 4. Code defaults
 *
 * Usage:
 * ```
 * import { config } from './config/config';
 * if (config.verbose) { ... }
 * ```
 *
 * See: https://github.com/link-foundation/lino-arguments
 * See: https://github.com/link-assistant/agent/issues/227
 */
import { makeConfig, getenv } from 'lino-arguments';

// ─── Agent Configuration (CLI flags, env vars, .lenv) ──────────────────────

/**
 * Resolved agent configuration interface.
 */
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

// Fallback helpers for when config is not yet initialized (early imports/tests)
function truthyEnv(key: string): boolean {
  const value = (process.env[key] ?? '').toLowerCase();
  return value === 'true' || value === '1';
}

function getEnvStr(key: string): string | undefined {
  return process.env[key];
}

/**
 * Default configuration values, used before initConfig() is called.
 * Falls back to direct env var reads for early-import and test scenarios.
 */
function defaultConfig(): AgentConfig {
  return {
    verbose: truthyEnv('LINK_ASSISTANT_AGENT_VERBOSE'),
    dryRun: truthyEnv('LINK_ASSISTANT_AGENT_DRY_RUN'),
    generateTitle: truthyEnv('LINK_ASSISTANT_AGENT_GENERATE_TITLE'),
    outputResponseModel: (() => {
      const v = (
        getEnvStr('LINK_ASSISTANT_AGENT_OUTPUT_RESPONSE_MODEL') ?? ''
      ).toLowerCase();
      if (v === 'false' || v === '0') return false;
      return true;
    })(),
    summarizeSession: (() => {
      const v = (
        getEnvStr('LINK_ASSISTANT_AGENT_SUMMARIZE_SESSION') ?? ''
      ).toLowerCase();
      if (v === 'false' || v === '0') return false;
      return true;
    })(),
    retryOnRateLimits: true,
    compactJson: truthyEnv('LINK_ASSISTANT_AGENT_COMPACT_JSON'),
    config: getEnvStr('LINK_ASSISTANT_AGENT_CONFIG') ?? '',
    configDir: getEnvStr('LINK_ASSISTANT_AGENT_CONFIG_DIR') ?? '',
    configContent: getEnvStr('LINK_ASSISTANT_AGENT_CONFIG_CONTENT') ?? '',
    disableAutoupdate: truthyEnv('LINK_ASSISTANT_AGENT_DISABLE_AUTOUPDATE'),
    disablePrune: truthyEnv('LINK_ASSISTANT_AGENT_DISABLE_PRUNE'),
    enableExperimentalModels: truthyEnv(
      'LINK_ASSISTANT_AGENT_ENABLE_EXPERIMENTAL_MODELS'
    ),
    disableAutocompact: truthyEnv('LINK_ASSISTANT_AGENT_DISABLE_AUTOCOMPACT'),
    experimental: truthyEnv('LINK_ASSISTANT_AGENT_EXPERIMENTAL'),
    experimentalWatcher:
      truthyEnv('LINK_ASSISTANT_AGENT_EXPERIMENTAL') ||
      truthyEnv('LINK_ASSISTANT_AGENT_EXPERIMENTAL_WATCHER'),
    retryTimeout: (() => {
      const v = getEnvStr('LINK_ASSISTANT_AGENT_RETRY_TIMEOUT');
      return v ? parseInt(v, 10) : 604800;
    })(),
    maxRetryDelay: (() => {
      const v = getEnvStr('LINK_ASSISTANT_AGENT_MAX_RETRY_DELAY');
      return v ? parseInt(v, 10) : 1200;
    })(),
    minRetryInterval: (() => {
      const v = getEnvStr('LINK_ASSISTANT_AGENT_MIN_RETRY_INTERVAL');
      return v ? parseInt(v, 10) : 30;
    })(),
    streamChunkTimeoutMs: (() => {
      const v = getEnvStr('LINK_ASSISTANT_AGENT_STREAM_CHUNK_TIMEOUT_MS');
      return v ? parseInt(v, 10) : 120000;
    })(),
    streamStepTimeoutMs: (() => {
      const v = getEnvStr('LINK_ASSISTANT_AGENT_STREAM_STEP_TIMEOUT_MS');
      return v ? parseInt(v, 10) : 600000;
    })(),
    mcpDefaultToolCallTimeout: (() => {
      const v = getEnvStr('LINK_ASSISTANT_AGENT_MCP_DEFAULT_TOOL_CALL_TIMEOUT');
      return v ? parseInt(v, 10) : 120000;
    })(),
    mcpMaxToolCallTimeout: (() => {
      const v = getEnvStr('LINK_ASSISTANT_AGENT_MCP_MAX_TOOL_CALL_TIMEOUT');
      return v ? parseInt(v, 10) : 600000;
    })(),
    verifyImagesAtReadTool:
      getEnvStr('LINK_ASSISTANT_AGENT_VERIFY_IMAGES_AT_READ_TOOL') !== 'false',
  };
}

/**
 * Globally available agent configuration.
 *
 * Before initConfig() is called, holds env-var-based defaults.
 * After initConfig(), holds the fully resolved config from makeConfig().
 *
 * Access directly: `config.verbose`, `config.dryRun`, etc.
 */
export let config: AgentConfig = defaultConfig();

/**
 * Whether initConfig() has been called.
 */
let initialized = false;

/**
 * Build the yargs options for makeConfig.
 * This is the single place where CLI options and env var defaults are defined together.
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
 * Initialize the global config using makeConfig from lino-arguments.
 *
 * Resolves all configuration from CLI args + env vars + .lenv + defaults.
 * After this call, the global `config` variable holds the fully resolved values.
 *
 * @param argv - Optional custom argv array to parse (default: process.argv)
 */
export function initConfig(argv?: string[]): AgentConfig {
  const parsed = makeConfig({
    yargs: buildAgentConfigOptions,
    lenv: { enabled: true },
    ...(argv ? { argv } : {}),
  });

  // Mutate in-place so destructured references stay valid.
  Object.assign(config, {
    verbose: parsed.verbose ?? false,
    dryRun: parsed.dryRun ?? false,
    generateTitle: parsed.generateTitle ?? false,
    outputResponseModel: parsed.outputResponseModel ?? true,
    summarizeSession: parsed.summarizeSession ?? true,
    retryOnRateLimits: parsed.retryOnRateLimits ?? true,
    compactJson: parsed.compactJson ?? false,
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
  });

  // Propagate verbose to env var for subprocess resilience (issue #227).
  if (config.verbose) {
    process.env.LINK_ASSISTANT_AGENT_VERBOSE = 'true';
  }

  initialized = true;
  return config;
}

/**
 * Check if config has been initialized via initConfig().
 */
export function isConfigInitialized(): boolean {
  return initialized;
}

/**
 * Check if verbose mode is active.
 * Checks: config.verbose AND env var for maximum subprocess resilience.
 */
export function isVerbose(): boolean {
  if (config.verbose) return true;
  return truthyEnv('LINK_ASSISTANT_AGENT_VERBOSE');
}

/**
 * Set verbose mode. Syncs to config, env var for subprocess resilience.
 * This is the critical fix for issue #227.
 */
export function setVerbose(value: boolean): void {
  config.verbose = value;
  if (value) {
    process.env.LINK_ASSISTANT_AGENT_VERBOSE = 'true';
  } else {
    delete process.env.LINK_ASSISTANT_AGENT_VERBOSE;
  }
}

/**
 * Update specific config values at runtime.
 */
export function updateConfig(updates: Partial<AgentConfig>): AgentConfig {
  Object.assign(config, updates);

  // Sync verbose to env var when updated
  if ('verbose' in updates) {
    if (updates.verbose) {
      process.env.LINK_ASSISTANT_AGENT_VERBOSE = 'true';
    } else {
      delete process.env.LINK_ASSISTANT_AGENT_VERBOSE;
    }
  }

  return config;
}

/**
 * Reset config to env-var-based defaults (for testing only).
 * Mutates the existing config object in-place so destructured references stay valid.
 */
export function resetConfig(): void {
  Object.assign(config, defaultConfig());
  initialized = false;
}

/**
 * Get a plain JSON-serializable snapshot of the resolved config.
 * Used for logging the configuration at startup.
 */
export function getConfigSnapshot(): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (value !== '' && value !== undefined) {
      snapshot[key] = value;
    }
  }
  return snapshot;
}
