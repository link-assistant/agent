export namespace Flag {
  // OPENCODE_AUTO_SHARE removed - no sharing support
  export const OPENCODE_CONFIG = process.env['OPENCODE_CONFIG'];
  export const OPENCODE_CONFIG_DIR = process.env['OPENCODE_CONFIG_DIR'];
  export const OPENCODE_CONFIG_CONTENT = process.env['OPENCODE_CONFIG_CONTENT'];
  export const OPENCODE_DISABLE_AUTOUPDATE = truthy(
    'OPENCODE_DISABLE_AUTOUPDATE'
  );
  export const OPENCODE_DISABLE_PRUNE = truthy('OPENCODE_DISABLE_PRUNE');
  export const OPENCODE_ENABLE_EXPERIMENTAL_MODELS = truthy(
    'OPENCODE_ENABLE_EXPERIMENTAL_MODELS'
  );
  export const OPENCODE_DISABLE_AUTOCOMPACT = truthy(
    'OPENCODE_DISABLE_AUTOCOMPACT'
  );

  // Experimental
  export const OPENCODE_EXPERIMENTAL = truthy('OPENCODE_EXPERIMENTAL');
  export const OPENCODE_EXPERIMENTAL_WATCHER =
    OPENCODE_EXPERIMENTAL || truthy('OPENCODE_EXPERIMENTAL_WATCHER');

  // Verbose mode - enables detailed logging of API requests
  export let OPENCODE_VERBOSE = truthy('OPENCODE_VERBOSE');

  // Allow setting verbose mode programmatically (e.g., from CLI --verbose flag)
  export function setVerbose(value: boolean) {
    OPENCODE_VERBOSE = value;
  }

  function truthy(key: string) {
    const value = process.env[key]?.toLowerCase();
    return value === 'true' || value === '1';
  }
}
