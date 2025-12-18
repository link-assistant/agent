export namespace Flag {
  // Helper to check env vars with new prefix first, then fall back to old prefix for backwards compatibility
  function getEnv(newKey: string, oldKey: string): string | undefined {
    return process.env[newKey] ?? process.env[oldKey];
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

  // Allow setting verbose mode programmatically (e.g., from CLI --verbose flag)
  export function setVerbose(value: boolean) {
    OPENCODE_VERBOSE = value;
  }

  // Allow setting dry run mode programmatically (e.g., from CLI --dry-run flag)
  export function setDryRun(value: boolean) {
    OPENCODE_DRY_RUN = value;
  }

  function truthy(key: string) {
    const value = process.env[key]?.toLowerCase();
    return value === 'true' || value === '1';
  }
}
