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
  readOnly: boolean;
  disableTools: string;
  permissionMode: string;
  permission: string;
  // Compatibility switches (issue #335): each restores the behaviour that
  // existed before the upstream reliability fixes, or tunes a new limit.
  bashShell: string;
  legacyToolOutput: boolean;
  legacyEditMatching: boolean;
  globFollowSymlinks: boolean;
  grepHidden: boolean;
  grepTimeoutMs: number;
  readMaxLines: number;
  readMaxBytes: number;
  legacyErrorNames: boolean;
  legacyTokenUsage: boolean;
  legacyLoopExit: boolean;
  mcpConnectTimeout: number;
}

// Fallback helpers for when config is not yet initialized (early imports/tests)
function truthyEnv(key: string): boolean {
  const value = (process.env[key] ?? '').toLowerCase();
  return value === 'true' || value === '1';
}

function getEnvStr(key: string): string | undefined {
  return process.env[key];
}

// Boolean env var that defaults to true unless set to "false"/"0".
function truthyEnvDefaultTrue(key: string): boolean {
  const value = (process.env[key] ?? '').toLowerCase();
  return !(value === 'false' || value === '0');
}

// Non-negative integer env var; falls back when unset or not a number.
function intEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Defaults of the compatibility switches added in issue #335. Shared by the
 * pre-init config, the yargs options and initConfig so they cannot drift.
 */
export const COMPAT_DEFAULTS = {
  bashShell: 'auto',
  legacyToolOutput: false,
  legacyEditMatching: false,
  globFollowSymlinks: false,
  grepHidden: true,
  grepTimeoutMs: 30_000,
  readMaxLines: 2000,
  readMaxBytes: 50 * 1024,
  legacyErrorNames: false,
  legacyTokenUsage: false,
  legacyLoopExit: false,
  mcpConnectTimeout: 30_000,
} as const;

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
    readOnly: truthyEnv('LINK_ASSISTANT_AGENT_READ_ONLY'),
    disableTools: getEnvStr('LINK_ASSISTANT_AGENT_DISABLE_TOOLS') ?? '',
    permissionMode: getEnvStr('LINK_ASSISTANT_AGENT_PERMISSION_MODE') ?? 'auto',
    permission: getEnvStr('LINK_ASSISTANT_AGENT_PERMISSION') ?? '',
    bashShell:
      getEnvStr('LINK_ASSISTANT_AGENT_BASH_SHELL') || COMPAT_DEFAULTS.bashShell,
    legacyToolOutput: truthyEnv('LINK_ASSISTANT_AGENT_LEGACY_TOOL_OUTPUT'),
    legacyEditMatching: truthyEnv('LINK_ASSISTANT_AGENT_LEGACY_EDIT_MATCHING'),
    globFollowSymlinks: truthyEnv('LINK_ASSISTANT_AGENT_GLOB_FOLLOW_SYMLINKS'),
    grepHidden: truthyEnvDefaultTrue('LINK_ASSISTANT_AGENT_GREP_HIDDEN'),
    grepTimeoutMs: intEnv(
      'LINK_ASSISTANT_AGENT_GREP_TIMEOUT_MS',
      COMPAT_DEFAULTS.grepTimeoutMs
    ),
    readMaxLines: intEnv(
      'LINK_ASSISTANT_AGENT_READ_MAX_LINES',
      COMPAT_DEFAULTS.readMaxLines
    ),
    readMaxBytes: intEnv(
      'LINK_ASSISTANT_AGENT_READ_MAX_BYTES',
      COMPAT_DEFAULTS.readMaxBytes
    ),
    legacyErrorNames: truthyEnv('LINK_ASSISTANT_AGENT_LEGACY_ERROR_NAMES'),
    legacyTokenUsage: truthyEnv('LINK_ASSISTANT_AGENT_LEGACY_TOKEN_USAGE'),
    legacyLoopExit: truthyEnv('LINK_ASSISTANT_AGENT_LEGACY_LOOP_EXIT'),
    mcpConnectTimeout: intEnv(
      'LINK_ASSISTANT_AGENT_MCP_CONNECT_TIMEOUT',
      COMPAT_DEFAULTS.mcpConnectTimeout
    ),
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
    })
    .option('read-only', {
      type: 'boolean',
      description:
        'Enforceable read-only / planning mode. Disables all filesystem-mutating and shell tools (bash, edit, write, multiedit, patch).',
      default: getenv('LINK_ASSISTANT_AGENT_READ_ONLY', false),
    })
    .option('disable-tools', {
      type: 'string',
      description:
        'Comma-separated list of tool ids to disable (e.g. "bash,write,edit"). Disabled tools are never exposed to the model and are rejected if invoked via batch.',
      default: getenv('LINK_ASSISTANT_AGENT_DISABLE_TOOLS', ''),
    })
    .option('permission-mode', {
      type: 'string',
      choices: ['auto', 'plan', 'readonly', 'ask'],
      description:
        'Permission policy for mutating tools. "auto" (default) allows everything; "plan" allows read-only shell and asks before mutations; "readonly" denies all mutations; "ask" asks before every mutating tool. Approvals are driven over JSON (permission_request / permission_response).',
      default: getenv('LINK_ASSISTANT_AGENT_PERMISSION_MODE', 'auto'),
    })
    .option('permission', {
      type: 'string',
      description:
        'OpenCode-compatible permission override as JSON, merged on top of --permission-mode. Example: \'{"edit":"ask","bash":{"git push*":"ask","*":"allow"},"webfetch":"allow"}\'.',
      default: getenv('LINK_ASSISTANT_AGENT_PERMISSION', ''),
    })
    // ─── Compatibility switches (issue #335) ───────────────────────────────
    .option('bash-shell', {
      type: 'string',
      description:
        'Shell used by the bash tool. "auto" (default) uses $SHELL when it is a POSIX shell (sh, bash, zsh, dash, ksh, mksh, ash), else bash, else /bin/sh; "legacy" uses the platform default shell (/bin/sh) as before; any other value is used as the shell path.',
      default: getenv('LINK_ASSISTANT_AGENT_BASH_SHELL', COMPAT_DEFAULTS.bashShell),
    })
    .option('legacy-tool-output', {
      type: 'boolean',
      description:
        'Restore the previous tool output formats: empty output from edit/write, head-truncated bash output, and an empty result instead of an error when read starts past the end of a file.',
      default: getenv('LINK_ASSISTANT_AGENT_LEGACY_TOOL_OUTPUT', false),
    })
    .option('legacy-edit-matching', {
      type: 'boolean',
      description:
        'Restore the previous edit matching: an empty oldString overwrites an existing file, and fuzzy block matching uses the old loose thresholds without the size guard.',
      default: getenv('LINK_ASSISTANT_AGENT_LEGACY_EDIT_MATCHING', false),
    })
    .option('glob-follow-symlinks', {
      type: 'boolean',
      description:
        'Follow symlinked directories in glob and ls (previous behaviour).',
      default: getenv('LINK_ASSISTANT_AGENT_GLOB_FOLLOW_SYMLINKS', false),
    })
    .option('grep-hidden', {
      type: 'boolean',
      description:
        'Search hidden files and directories in grep (default true; .git is always skipped). Use --no-grep-hidden for the previous behaviour.',
      default: getenv('LINK_ASSISTANT_AGENT_GREP_HIDDEN', COMPAT_DEFAULTS.grepHidden),
    })
    .option('grep-timeout-ms', {
      type: 'number',
      description: 'Timeout for one grep search in milliseconds (0 = no timeout)',
      default: getenv(
        'LINK_ASSISTANT_AGENT_GREP_TIMEOUT_MS',
        COMPAT_DEFAULTS.grepTimeoutMs
      ),
    })
    .option('read-max-lines', {
      type: 'number',
      description:
        'Maximum number of lines one read call may return (0 = no cap on the limit parameter)',
      default: getenv(
        'LINK_ASSISTANT_AGENT_READ_MAX_LINES',
        COMPAT_DEFAULTS.readMaxLines
      ),
    })
    .option('read-max-bytes', {
      type: 'number',
      description:
        'Maximum bytes of file content one read call may return (0 = no cap)',
      default: getenv(
        'LINK_ASSISTANT_AGENT_READ_MAX_BYTES',
        COMPAT_DEFAULTS.readMaxBytes
      ),
    })
    .option('legacy-error-names', {
      type: 'boolean',
      description:
        'Report errors in JSON output under their previous names (ContextOverflowError is reported as APIError).',
      default: getenv('LINK_ASSISTANT_AGENT_LEGACY_ERROR_NAMES', false),
    })
    .option('legacy-token-usage', {
      type: 'boolean',
      description:
        'Report tokens.output including reasoning tokens and compute cost from it, as before.',
      default: getenv('LINK_ASSISTANT_AGENT_LEGACY_TOKEN_USAGE', false),
    })
    .option('legacy-loop-exit', {
      type: 'boolean',
      description:
        'End the turn on any finish reason other than tool-calls/unknown, even if tools ran in that step (previous behaviour).',
      default: getenv('LINK_ASSISTANT_AGENT_LEGACY_LOOP_EXIT', false),
    })
    .option('mcp-connect-timeout', {
      type: 'number',
      description:
        'Default timeout in milliseconds for connecting to and initializing an MCP server (per-server "connect_timeout" overrides it; 0 = no timeout)',
      default: getenv(
        'LINK_ASSISTANT_AGENT_MCP_CONNECT_TIMEOUT',
        COMPAT_DEFAULTS.mcpConnectTimeout
      ),
    });
}

function nonNegative(value: unknown, fallback: number): number {
  const n = typeof value === 'string' ? parseInt(value, 10) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : fallback;
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
    readOnly: parsed.readOnly ?? false,
    disableTools: parsed.disableTools ?? '',
    permissionMode: parsed.permissionMode ?? 'auto',
    permission: parsed.permission ?? '',
    bashShell: parsed.bashShell || COMPAT_DEFAULTS.bashShell,
    legacyToolOutput: parsed.legacyToolOutput ?? false,
    legacyEditMatching: parsed.legacyEditMatching ?? false,
    globFollowSymlinks: parsed.globFollowSymlinks ?? false,
    grepHidden: parsed.grepHidden ?? COMPAT_DEFAULTS.grepHidden,
    grepTimeoutMs: nonNegative(
      parsed.grepTimeoutMs,
      COMPAT_DEFAULTS.grepTimeoutMs
    ),
    readMaxLines: nonNegative(parsed.readMaxLines, COMPAT_DEFAULTS.readMaxLines),
    readMaxBytes: nonNegative(parsed.readMaxBytes, COMPAT_DEFAULTS.readMaxBytes),
    legacyErrorNames: parsed.legacyErrorNames ?? false,
    legacyTokenUsage: parsed.legacyTokenUsage ?? false,
    legacyLoopExit: parsed.legacyLoopExit ?? false,
    mcpConnectTimeout: nonNegative(
      parsed.mcpConnectTimeout,
      COMPAT_DEFAULTS.mcpConnectTimeout
    ),
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
