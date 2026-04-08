/**
 * CLI argument utilities for parsing process.argv directly
 * These provide safeguards against yargs caching issues (#192)
 */

/**
 * Extract a named argument from an arbitrary argv-like array.
 * Supports --name=value, --name value, and optional short aliases (-x=value, -x value).
 * @returns The argument value or null if not found
 */
function extractArgFromArray(
  args: string[],
  longFlag: string,
  shortFlag?: string
): string | null {
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
 * Extract a named argument directly from process.argv, falling back to Bun.argv.
 * Bun global installs and compiled binaries may have different process.argv structures
 * (see oven-sh/bun#22157), so we check both sources. (#192, #239)
 * @returns The argument value from CLI or null if not found
 */
function getArgFromProcessArgv(
  longFlag: string,
  shortFlag?: string
): string | null {
  // Try process.argv first (standard Node.js / Bun behavior)
  const fromProcess = extractArgFromArray(process.argv, longFlag, shortFlag);
  if (fromProcess !== null) {
    return fromProcess;
  }

  // Fallback: try Bun.argv if available — Bun global installs may have
  // different process.argv structure (extra elements, shifted indices) (#239)
  if (typeof globalThis.Bun !== 'undefined' && globalThis.Bun.argv) {
    const fromBun = extractArgFromArray(
      globalThis.Bun.argv,
      longFlag,
      shortFlag
    );
    if (fromBun !== null) {
      return fromBun;
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

/**
 * Extract --compaction-models argument directly from process.argv
 * The value is a links notation references sequence, e.g.:
 *   "(big-pickle nemotron-3-super-free minimax-m2.5-free gpt-5-nano qwen3.6-plus-free same)"
 * @returns The compaction models argument from CLI or null if not found
 * @see https://github.com/link-assistant/agent/issues/232
 */
export function getCompactionModelsFromProcessArgv(): string | null {
  return getArgFromProcessArgv('compaction-models');
}
