/**
 * CLI argument utilities for parsing process.argv directly
 * These provide safeguards against yargs caching issues (#192)
 */

/**
 * Extract a named argument directly from process.argv.
 * Supports --name=value, --name value, and optional short aliases (-x=value, -x value).
 * @returns The argument value from CLI or null if not found
 */
function getArgFromProcessArgv(
  longFlag: string,
  shortFlag?: string
): string | null {
  const args = process.argv;
  const longPrefix = `--${longFlag}=`;
  const shortPrefix = shortFlag ? `-${shortFlag}=` : null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    // Handle --flag=value format
    if (arg.startsWith(longPrefix)) {
      return arg.substring(longPrefix.length);
    }
    // Handle --flag value format
    if (arg === `--${longFlag}` && i + 1 < args.length) {
      return args[i + 1];
    }
    if (shortPrefix) {
      // Handle -x=value format
      if (arg.startsWith(shortPrefix)) {
        return arg.substring(shortPrefix.length);
      }
      // Handle -x value format (but not if it looks like another flag)
      if (
        arg === `-${shortFlag}` &&
        i + 1 < args.length &&
        !args[i + 1].startsWith('-')
      ) {
        return args[i + 1];
      }
    }
  }
  return null;
}

/**
 * Extract model argument directly from process.argv
 * This is a safeguard against yargs caching issues (#192)
 * @returns The model argument from CLI or null if not found
 */
export function getModelFromProcessArgv(): string | null {
  return getArgFromProcessArgv('model', 'm');
}

/**
 * Extract --compaction-model argument directly from process.argv
 * @returns The compaction model argument from CLI or null if not found
 * @see https://github.com/link-assistant/agent/issues/219
 */
export function getCompactionModelFromProcessArgv(): string | null {
  return getArgFromProcessArgv('compaction-model');
}

/**
 * Extract --compaction-safety-margin argument directly from process.argv
 * @returns The compaction safety margin (%) from CLI or null if not found
 * @see https://github.com/link-assistant/agent/issues/219
 */
export function getCompactionSafetyMarginFromProcessArgv(): string | null {
  return getArgFromProcessArgv('compaction-safety-margin');
}
