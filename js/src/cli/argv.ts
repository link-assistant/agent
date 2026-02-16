/**
 * CLI argument utilities for parsing process.argv directly
 * These provide safeguards against yargs caching issues (#192)
 */

/**
 * Extract model argument directly from process.argv
 * This is a safeguard against yargs caching issues (#192)
 * @returns The model argument from CLI or null if not found
 */
export function getModelFromProcessArgv(): string | null {
  const args = process.argv;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    // Handle --model=value format
    if (arg.startsWith('--model=')) {
      return arg.substring('--model='.length);
    }
    // Handle --model value format
    if (arg === '--model' && i + 1 < args.length) {
      return args[i + 1];
    }
    // Handle -m=value format
    if (arg.startsWith('-m=')) {
      return arg.substring('-m='.length);
    }
    // Handle -m value format (but not if it looks like another flag)
    if (arg === '-m' && i + 1 < args.length && !args[i + 1].startsWith('-')) {
      return args[i + 1];
    }
  }
  return null;
}
