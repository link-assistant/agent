/**
 * Global feature flags and configuration for the agent.
 *
 * All values are resolved from the centralized AgentConfig (lino-arguments),
 * which merges CLI args, env vars, and .lenv files in a single place.
 * When AgentConfig is not yet initialized (e.g., early imports or tests),
 * flags fall back to reading process.env directly.
 *
 * See: https://github.com/link-assistant/agent/issues/227
 * See: https://github.com/link-foundation/lino-arguments
 */
import {
  isAgentConfigInitialized,
  getAgentConfig,
  updateAgentConfig,
} from './agent-config';

export namespace Flag {
  // Fallback helpers for when AgentConfig is not yet initialized
  function truthyEnv(key: string): boolean {
    const value = (process.env[key] ?? '').toLowerCase();
    return value === 'true' || value === '1';
  }

  function getEnv(key: string): string | undefined {
    return process.env[key];
  }

  // --- Config-backed getters ---
  // Each getter first checks if AgentConfig is initialized (preferred),
  // then falls back to direct env var reads (for tests/early imports).

  export function getConfig(): string | undefined {
    if (isAgentConfigInitialized()) return getAgentConfig().config || undefined;
    return getEnv('LINK_ASSISTANT_AGENT_CONFIG');
  }

  export function getConfigDir(): string | undefined {
    if (isAgentConfigInitialized())
      return getAgentConfig().configDir || undefined;
    return getEnv('LINK_ASSISTANT_AGENT_CONFIG_DIR');
  }

  export function getConfigContent(): string | undefined {
    if (isAgentConfigInitialized())
      return getAgentConfig().configContent || undefined;
    return getEnv('LINK_ASSISTANT_AGENT_CONFIG_CONTENT');
  }

  // Legacy static properties (kept for backward compatibility with existing code)
  // These read at import time and may be stale; prefer the getter functions above.
  export const CONFIG = getEnv('LINK_ASSISTANT_AGENT_CONFIG');
  export const CONFIG_DIR = getEnv('LINK_ASSISTANT_AGENT_CONFIG_DIR');
  export const CONFIG_CONTENT = getEnv('LINK_ASSISTANT_AGENT_CONFIG_CONTENT');

  export function isDisableAutoupdate(): boolean {
    if (isAgentConfigInitialized()) return getAgentConfig().disableAutoupdate;
    return truthyEnv('LINK_ASSISTANT_AGENT_DISABLE_AUTOUPDATE');
  }
  export const DISABLE_AUTOUPDATE = isDisableAutoupdate();

  export function isDisablePrune(): boolean {
    if (isAgentConfigInitialized()) return getAgentConfig().disablePrune;
    return truthyEnv('LINK_ASSISTANT_AGENT_DISABLE_PRUNE');
  }
  export const DISABLE_PRUNE = isDisablePrune();

  export function isEnableExperimentalModels(): boolean {
    if (isAgentConfigInitialized())
      return getAgentConfig().enableExperimentalModels;
    return truthyEnv('LINK_ASSISTANT_AGENT_ENABLE_EXPERIMENTAL_MODELS');
  }
  export const ENABLE_EXPERIMENTAL_MODELS = isEnableExperimentalModels();

  export function isDisableAutocompact(): boolean {
    if (isAgentConfigInitialized()) return getAgentConfig().disableAutocompact;
    return truthyEnv('LINK_ASSISTANT_AGENT_DISABLE_AUTOCOMPACT');
  }
  export const DISABLE_AUTOCOMPACT = isDisableAutocompact();

  // Experimental
  export function isExperimental(): boolean {
    if (isAgentConfigInitialized()) return getAgentConfig().experimental;
    return truthyEnv('LINK_ASSISTANT_AGENT_EXPERIMENTAL');
  }
  export const EXPERIMENTAL = isExperimental();

  export function isExperimentalWatcher(): boolean {
    if (isAgentConfigInitialized()) return getAgentConfig().experimentalWatcher;
    return (
      isExperimental() || truthyEnv('LINK_ASSISTANT_AGENT_EXPERIMENTAL_WATCHER')
    );
  }
  export const EXPERIMENTAL_WATCHER = isExperimentalWatcher();

  // --- Mutable flags (set via CLI middleware) ---

  // Verbose mode - the most critical flag for debugging.
  // Resolved from: CLI --verbose > env LINK_ASSISTANT_AGENT_VERBOSE > .lenv > false
  export let VERBOSE = truthyEnv('LINK_ASSISTANT_AGENT_VERBOSE');

  // Dry run mode
  export let DRY_RUN = truthyEnv('LINK_ASSISTANT_AGENT_DRY_RUN');

  // Title generation
  export let GENERATE_TITLE = truthyEnv('LINK_ASSISTANT_AGENT_GENERATE_TITLE');

  export function setGenerateTitle(value: boolean) {
    GENERATE_TITLE = value;
    if (isAgentConfigInitialized()) {
      updateAgentConfig({ generateTitle: value });
    }
  }

  // Output response model (default: true)
  export let OUTPUT_RESPONSE_MODEL = (() => {
    const value = (
      getEnv('LINK_ASSISTANT_AGENT_OUTPUT_RESPONSE_MODEL') ?? ''
    ).toLowerCase();
    if (value === 'false' || value === '0') return false;
    return true;
  })();

  export function setOutputResponseModel(value: boolean) {
    OUTPUT_RESPONSE_MODEL = value;
    if (isAgentConfigInitialized()) {
      updateAgentConfig({ outputResponseModel: value });
    }
  }

  // Session summarization (default: true)
  export let SUMMARIZE_SESSION = (() => {
    const value = (
      getEnv('LINK_ASSISTANT_AGENT_SUMMARIZE_SESSION') ?? ''
    ).toLowerCase();
    if (value === 'false' || value === '0') return false;
    return true;
  })();

  export function setSummarizeSession(value: boolean) {
    SUMMARIZE_SESSION = value;
    if (isAgentConfigInitialized()) {
      updateAgentConfig({ summarizeSession: value });
    }
  }

  // Retry timeout
  export function RETRY_TIMEOUT(): number {
    if (isAgentConfigInitialized()) return getAgentConfig().retryTimeout;
    const val = getEnv('LINK_ASSISTANT_AGENT_RETRY_TIMEOUT');
    return val ? parseInt(val, 10) : 604800;
  }

  // Max retry delay (returns ms)
  export function MAX_RETRY_DELAY(): number {
    if (isAgentConfigInitialized())
      return getAgentConfig().maxRetryDelay * 1000;
    const val = getEnv('LINK_ASSISTANT_AGENT_MAX_RETRY_DELAY');
    return val ? parseInt(val, 10) * 1000 : 1200000;
  }

  // Min retry interval (returns ms)
  export function MIN_RETRY_INTERVAL(): number {
    if (isAgentConfigInitialized())
      return getAgentConfig().minRetryInterval * 1000;
    const val = getEnv('LINK_ASSISTANT_AGENT_MIN_RETRY_INTERVAL');
    return val ? parseInt(val, 10) * 1000 : 30000;
  }

  // Stream timeouts
  export function STREAM_CHUNK_TIMEOUT_MS(): number {
    if (isAgentConfigInitialized())
      return getAgentConfig().streamChunkTimeoutMs;
    const val = getEnv('LINK_ASSISTANT_AGENT_STREAM_CHUNK_TIMEOUT_MS');
    return val ? parseInt(val, 10) : 120_000;
  }

  export function STREAM_STEP_TIMEOUT_MS(): number {
    if (isAgentConfigInitialized()) return getAgentConfig().streamStepTimeoutMs;
    const val = getEnv('LINK_ASSISTANT_AGENT_STREAM_STEP_TIMEOUT_MS');
    return val ? parseInt(val, 10) : 600_000;
  }

  // Compact JSON mode
  let _compactJson: boolean | null = null;

  export function COMPACT_JSON(): boolean {
    if (_compactJson !== null) return _compactJson;
    if (isAgentConfigInitialized()) return getAgentConfig().compactJson;
    return truthyEnv('LINK_ASSISTANT_AGENT_COMPACT_JSON');
  }

  // MCP timeout config (previously direct env reads in mcp/index.ts)
  export function MCP_DEFAULT_TOOL_CALL_TIMEOUT(): number {
    if (isAgentConfigInitialized())
      return getAgentConfig().mcpDefaultToolCallTimeout;
    const val = getEnv('LINK_ASSISTANT_AGENT_MCP_DEFAULT_TOOL_CALL_TIMEOUT');
    return val ? parseInt(val, 10) : 120000;
  }

  export function MCP_MAX_TOOL_CALL_TIMEOUT(): number {
    if (isAgentConfigInitialized())
      return getAgentConfig().mcpMaxToolCallTimeout;
    const val = getEnv('LINK_ASSISTANT_AGENT_MCP_MAX_TOOL_CALL_TIMEOUT');
    return val ? parseInt(val, 10) : 600000;
  }

  // Image verification (previously direct env read in tool/read.ts)
  export function VERIFY_IMAGES_AT_READ_TOOL(): boolean {
    if (isAgentConfigInitialized())
      return getAgentConfig().verifyImagesAtReadTool;
    return (
      getEnv('LINK_ASSISTANT_AGENT_VERIFY_IMAGES_AT_READ_TOOL') !== 'false'
    );
  }

  /**
   * Set verbose mode. Also syncs to env var and AgentConfig for subprocess resilience.
   * This is the critical fix for issue #227.
   */
  export function setVerbose(value: boolean) {
    VERBOSE = value;
    if (value) {
      process.env.LINK_ASSISTANT_AGENT_VERBOSE = 'true';
    } else {
      delete process.env.LINK_ASSISTANT_AGENT_VERBOSE;
    }
    if (isAgentConfigInitialized()) {
      updateAgentConfig({ verbose: value });
    }
  }

  /**
   * Check if verbose mode is active.
   * Checks: in-memory flag, AgentConfig, AND env var for maximum resilience.
   * This triple-check ensures --verbose works even if modules are re-evaluated.
   */
  export function isVerbose(): boolean {
    if (VERBOSE) return true;
    if (isAgentConfigInitialized() && getAgentConfig().verbose) return true;
    return truthyEnv('LINK_ASSISTANT_AGENT_VERBOSE');
  }

  export function setDryRun(value: boolean) {
    DRY_RUN = value;
    if (isAgentConfigInitialized()) {
      updateAgentConfig({ dryRun: value });
    }
  }

  export function setCompactJson(value: boolean) {
    _compactJson = value;
    if (isAgentConfigInitialized()) {
      updateAgentConfig({ compactJson: value });
    }
  }

  // Retry on rate limits
  export let RETRY_ON_RATE_LIMITS = true;

  export function setRetryOnRateLimits(value: boolean) {
    RETRY_ON_RATE_LIMITS = value;
    if (isAgentConfigInitialized()) {
      updateAgentConfig({ retryOnRateLimits: value });
    }
  }
}
