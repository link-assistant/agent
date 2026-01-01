import makeLog, { levels, LogLevel } from 'log-lazy';
import { Flag } from '../flag/flag.ts';

/**
 * JSON Lazy Logger
 *
 * Implements lazy logging pattern using log-lazy library.
 * All log output is JSON formatted and wrapped in { log: { ... } } structure
 * for easy parsing alongside regular JSON output.
 *
 * Key features:
 * - Lazy evaluation: log arguments are only computed if logging is enabled
 * - JSON output: all logs are parsable JSON in { log: { ... } } format
 * - Level control: logs respect --verbose flag and LINK_ASSISTANT_AGENT_VERBOSE env
 * - Type-safe: full TypeScript support
 *
 * Usage:
 *   import { lazyLog } from './util/log-lazy.ts';
 *
 *   // Simple string message
 *   lazyLog.info(() => 'Starting process');
 *
 *   // Object data (preferred - avoids expensive JSON.stringify when disabled)
 *   lazyLog.debug(() => ({ action: 'fetch', url: someUrl }));
 *
 *   // Complex computed message
 *   lazyLog.verbose(() => `Processed ${items.length} items: ${JSON.stringify(items)}`);
 */

// Custom log levels using bit flags for fine-grained control
const LEVEL_DISABLED = 0;
const LEVEL_ERROR = levels.error;
const LEVEL_WARN = levels.warn | LEVEL_ERROR;
const LEVEL_INFO = levels.info | LEVEL_WARN;
const LEVEL_DEBUG = levels.debug | LEVEL_INFO;
const LEVEL_VERBOSE = levels.verbose | LEVEL_DEBUG;
const LEVEL_TRACE = levels.trace | LEVEL_VERBOSE;

// Map of preset level configurations
const LEVEL_PRESETS = {
  disabled: LEVEL_DISABLED,
  error: LEVEL_ERROR,
  warn: LEVEL_WARN,
  info: LEVEL_INFO,
  debug: LEVEL_DEBUG,
  verbose: LEVEL_VERBOSE,
  trace: LEVEL_TRACE,
  // Convenience aliases
  production: LEVEL_WARN,
  development: LEVEL_DEBUG,
} as const;

type LevelPreset = keyof typeof LEVEL_PRESETS;

/**
 * Format a log entry as JSON object wrapped in { log: { ... } }
 */
function formatLogEntry(
  level: string,
  data: unknown,
  tags?: Record<string, unknown>
): string {
  const timestamp = new Date().toISOString();
  const logEntry: Record<string, unknown> = {
    level,
    timestamp,
    ...tags,
  };

  // Handle different data types
  if (typeof data === 'string') {
    logEntry.message = data;
  } else if (data instanceof Error) {
    logEntry.message = data.message;
    logEntry.error = {
      name: data.name,
      message: data.message,
      stack: data.stack,
    };
  } else if (typeof data === 'object' && data !== null) {
    // Spread object properties into the log entry
    Object.assign(logEntry, data);
  } else {
    logEntry.message = String(data);
  }

  return JSON.stringify({ log: logEntry });
}

/**
 * Create the output function that writes to stderr
 */
function createOutput(
  level: string,
  tags?: Record<string, unknown>
): (data: unknown) => void {
  return (data: unknown) => {
    const json = formatLogEntry(level, data, tags);
    // Use stderr to avoid interfering with stdout JSON output
    process.stderr.write(json + '\n');
  };
}

/**
 * LazyLogger interface extending log-lazy with JSON output
 */
export interface LazyLogger {
  // Log at info level (default)
  (fn: () => unknown): void;

  // Log levels
  error(fn: () => unknown): void;
  warn(fn: () => unknown): void;
  info(fn: () => unknown): void;
  debug(fn: () => unknown): void;
  verbose(fn: () => unknown): void;
  trace(fn: () => unknown): void;

  // Level management
  enableLevel(level: LogLevel): void;
  disableLevel(level: LogLevel): void;
  setLevel(level: LevelPreset | number): void;
  getEnabledLevels(): LogLevel[];
  shouldLog(level: LogLevel): boolean;

  // Tag support
  tag(key: string, value: unknown): LazyLogger;
  clone(): LazyLogger;

  // Configuration
  readonly enabled: boolean;
}

/**
 * Create a lazy logger with JSON output format
 */
export function createLazyLogger(
  initialTags?: Record<string, unknown>
): LazyLogger {
  // Determine initial log level based on verbose flag
  const initialLevel = Flag.OPENCODE_VERBOSE ? LEVEL_VERBOSE : LEVEL_DISABLED;

  // Create base log-lazy instance
  const baseLog = makeLog({ level: initialLevel });
  const tags = { ...initialTags };

  // Custom output functions that format as JSON
  const outputError = createOutput('error', tags);
  const outputWarn = createOutput('warn', tags);
  const outputInfo = createOutput('info', tags);
  const outputDebug = createOutput('debug', tags);
  const outputVerbose = createOutput('verbose', tags);
  const outputTrace = createOutput('trace', tags);

  // Create wrapper that uses JSON output
  const wrappedLog = function (fn: () => unknown): void {
    baseLog.info(() => {
      const result = fn();
      outputInfo(result);
      return ''; // Return empty string as the base logger just needs something
    });
  } as LazyLogger;

  wrappedLog.error = (fn: () => unknown): void => {
    baseLog.error(() => {
      const result = fn();
      outputError(result);
      return '';
    });
  };

  wrappedLog.warn = (fn: () => unknown): void => {
    baseLog.warn(() => {
      const result = fn();
      outputWarn(result);
      return '';
    });
  };

  wrappedLog.info = (fn: () => unknown): void => {
    baseLog.info(() => {
      const result = fn();
      outputInfo(result);
      return '';
    });
  };

  wrappedLog.debug = (fn: () => unknown): void => {
    baseLog.debug(() => {
      const result = fn();
      outputDebug(result);
      return '';
    });
  };

  wrappedLog.verbose = (fn: () => unknown): void => {
    baseLog.verbose(() => {
      const result = fn();
      outputVerbose(result);
      return '';
    });
  };

  wrappedLog.trace = (fn: () => unknown): void => {
    baseLog.trace(() => {
      const result = fn();
      outputTrace(result);
      return '';
    });
  };

  // Level management
  wrappedLog.enableLevel = (level: LogLevel): void => {
    baseLog.enableLevel(level);
  };

  wrappedLog.disableLevel = (level: LogLevel): void => {
    baseLog.disableLevel(level);
  };

  wrappedLog.setLevel = (level: LevelPreset | number): void => {
    const numericLevel =
      typeof level === 'string' ? LEVEL_PRESETS[level] : level;

    // Reset all levels and enable the new one
    Object.values([
      'error',
      'warn',
      'info',
      'debug',
      'verbose',
      'trace',
    ]).forEach((l) => baseLog.disableLevel(l as LogLevel));

    // Enable appropriate levels based on the numeric level
    if (numericLevel & levels.error) baseLog.enableLevel('error');
    if (numericLevel & levels.warn) baseLog.enableLevel('warn');
    if (numericLevel & levels.info) baseLog.enableLevel('info');
    if (numericLevel & levels.debug) baseLog.enableLevel('debug');
    if (numericLevel & levels.verbose) baseLog.enableLevel('verbose');
    if (numericLevel & levels.trace) baseLog.enableLevel('trace');
  };

  wrappedLog.getEnabledLevels = (): LogLevel[] => {
    return baseLog.getEnabledLevels();
  };

  wrappedLog.shouldLog = (level: LogLevel): boolean => {
    return baseLog.shouldLog(level);
  };

  // Tag support
  wrappedLog.tag = (key: string, value: unknown): LazyLogger => {
    tags[key] = value;
    return wrappedLog;
  };

  wrappedLog.clone = (): LazyLogger => {
    return createLazyLogger({ ...tags });
  };

  // Configuration
  Object.defineProperty(wrappedLog, 'enabled', {
    get: () => Flag.OPENCODE_VERBOSE,
    enumerable: true,
  });

  return wrappedLog;
}

/**
 * Default lazy logger instance
 * Enabled only when --verbose flag or LINK_ASSISTANT_AGENT_VERBOSE env is set
 */
export const lazyLog = createLazyLogger({ service: 'agent' });

/**
 * Utility to update the global logger level at runtime
 * Call this after Flag.setVerbose() to sync the logger state
 */
export function syncLoggerWithVerboseFlag(): void {
  if (Flag.OPENCODE_VERBOSE) {
    lazyLog.setLevel('verbose');
  } else {
    lazyLog.setLevel('disabled');
  }
}

// Export level constants for external use
export { levels, LEVEL_PRESETS };
export type { LevelPreset };
