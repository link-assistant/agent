import path from 'path';
import fs from 'fs/promises';
import { Global } from '../global';
import z from 'zod';
import makeLog, { levels } from 'log-lazy';
import { Flag } from '../flag/flag.ts';

/**
 * Logging module with JSON output and lazy evaluation support.
 *
 * Features:
 * - JSON formatted output: All logs are wrapped in { log: { ... } } structure
 * - Lazy evaluation: Use lazy() methods to defer expensive computations
 * - Level control: Respects --verbose flag and log level settings
 * - File logging: Writes to file when not in verbose/print mode
 *
 * The JSON format ensures all output is parsable, separating logs from regular output.
 */
export namespace Log {
  export const Level = z
    .enum(['DEBUG', 'INFO', 'WARN', 'ERROR'])
    .meta({ ref: 'LogLevel', description: 'Log level' });
  export type Level = z.infer<typeof Level>;

  const levelPriority: Record<Level, number> = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
  };

  let level: Level = 'INFO';
  let jsonOutput = false; // Whether to output JSON format (enabled in verbose mode)

  function shouldLog(input: Level): boolean {
    return levelPriority[input] >= levelPriority[level];
  }

  /**
   * Logger interface with support for both immediate and lazy logging.
   *
   * All logging methods accept either:
   * - A message string/object/Error with optional extra data
   * - A function that returns the data to log (lazy evaluation)
   *
   * Lazy logging: The function is only called if logging is enabled for that level,
   * avoiding expensive computations when logs are disabled.
   */
  export type Logger = {
    // Unified logging - supports both immediate and lazy (callback) styles
    debug(
      message?: any | (() => { message?: string; [key: string]: any }),
      extra?: Record<string, any>
    ): void;
    info(
      message?: any | (() => { message?: string; [key: string]: any }),
      extra?: Record<string, any>
    ): void;
    error(
      message?: any | (() => { message?: string; [key: string]: any }),
      extra?: Record<string, any>
    ): void;
    warn(
      message?: any | (() => { message?: string; [key: string]: any }),
      extra?: Record<string, any>
    ): void;

    tag(key: string, value: string): Logger;
    clone(): Logger;
    time(
      message: string,
      extra?: Record<string, any>
    ): {
      stop(): void;
      [Symbol.dispose](): void;
    };
  };

  const loggers = new Map<string, Logger>();

  export const Default = create({ service: 'default' });

  export interface Options {
    print: boolean;
    dev?: boolean;
    level?: Level;
  }

  let logpath = '';
  export function file() {
    return logpath;
  }
  let write = (msg: any) => Bun.stderr.write(msg);

  // Initialize log-lazy for controlling lazy log execution
  let lazyLogInstance = makeLog({ level: 0 }); // Start disabled

  export async function init(options: Options) {
    if (options.level) level = options.level;
    cleanup(Global.Path.log);

    // Always use JSON output format for logs
    jsonOutput = true;

    // Configure lazy logging level based on verbose flag
    if (Flag.OPENCODE_VERBOSE || options.print) {
      // Enable all levels for lazy logging when verbose
      lazyLogInstance = makeLog({
        level: levels.debug | levels.info | levels.warn | levels.error,
      });
    } else {
      // Disable lazy logging when not verbose
      lazyLogInstance = makeLog({ level: 0 });
    }

    if (options.print) {
      // In print mode, output to stderr
      // No file logging needed
    } else {
      // In normal mode, write to file
      logpath = path.join(
        Global.Path.log,
        options.dev
          ? 'dev.log'
          : new Date().toISOString().split('.')[0].replace(/:/g, '') + '.log'
      );
      const logfile = Bun.file(logpath);
      await fs.truncate(logpath).catch(() => {});
      const writer = logfile.writer();
      write = async (msg: any) => {
        const num = writer.write(msg);
        writer.flush();
        return num;
      };
    }
  }

  async function cleanup(dir: string) {
    const glob = new Bun.Glob('????-??-??T??????.log');
    const files = await Array.fromAsync(
      glob.scan({
        cwd: dir,
        absolute: true,
      })
    );
    if (files.length <= 5) return;

    const filesToDelete = files.slice(0, -10);
    await Promise.all(
      filesToDelete.map((file) => fs.unlink(file).catch(() => {}))
    );
  }

  function formatError(error: Error, depth = 0): string {
    const result = error.message;
    return error.cause instanceof Error && depth < 10
      ? result + ' Caused by: ' + formatError(error.cause, depth + 1)
      : result;
  }

  /**
   * Format log entry as JSON object wrapped in { log: { ... } }
   */
  function formatJson(
    logLevel: Level,
    message: any,
    tags: Record<string, any>,
    extra?: Record<string, any>
  ): string {
    const timestamp = new Date().toISOString();
    const logEntry: Record<string, any> = {
      level: logLevel.toLowerCase(),
      timestamp,
      ...tags,
      ...extra,
    };

    if (message !== undefined && message !== null) {
      if (typeof message === 'string') {
        logEntry.message = message;
      } else if (message instanceof Error) {
        logEntry.message = message.message;
        logEntry.error = {
          name: message.name,
          message: message.message,
          stack: message.stack,
        };
      } else if (typeof message === 'object') {
        Object.assign(logEntry, message);
      } else {
        logEntry.message = String(message);
      }
    }

    return JSON.stringify({ log: logEntry });
  }

  let last = Date.now();
  export function create(tags?: Record<string, any>) {
    tags = tags || {};

    const service = tags['service'];
    if (service && typeof service === 'string') {
      const cached = loggers.get(service);
      if (cached) {
        return cached;
      }
    }

    // Legacy format for file logging (backward compatibility)
    function buildLegacy(message: any, extra?: Record<string, any>) {
      const prefix = Object.entries({
        ...tags,
        ...extra,
      })
        .filter(([_, value]) => value !== undefined && value !== null)
        .map(([key, value]) => {
          const prefix = `${key}=`;
          if (value instanceof Error) return prefix + formatError(value);
          if (typeof value === 'object') return prefix + JSON.stringify(value);
          return prefix + value;
        })
        .join(' ');
      const next = new Date();
      const diff = next.getTime() - last;
      last = next.getTime();
      return (
        [next.toISOString().split('.')[0], '+' + diff + 'ms', prefix, message]
          .filter(Boolean)
          .join(' ') + '\n'
      );
    }

    // Choose output format based on jsonOutput flag
    function output(
      logLevel: Level,
      message: any,
      extra?: Record<string, any>
    ) {
      if (jsonOutput) {
        // Use our custom JSON formatting for { log: { ... } } format
        write(formatJson(logLevel, message, tags || {}, extra) + '\n');
      } else {
        write(logLevel.padEnd(5) + ' ' + buildLegacy(message, extra));
      }
    }

    const result: Logger = {
      debug(message?: any, extra?: Record<string, any>) {
        if (!shouldLog('DEBUG')) return;

        // Check if message is a function (lazy logging)
        if (typeof message === 'function') {
          lazyLogInstance.debug(() => {
            const data = message();
            const { message: msg, ...extraData } = data;
            output('DEBUG', msg, extraData);
            return '';
          });
        } else {
          output('DEBUG', message, extra);
        }
      },
      info(message?: any, extra?: Record<string, any>) {
        if (!shouldLog('INFO')) return;

        // Check if message is a function (lazy logging)
        if (typeof message === 'function') {
          lazyLogInstance.info(() => {
            const data = message();
            const { message: msg, ...extraData } = data;
            output('INFO', msg, extraData);
            return '';
          });
        } else {
          output('INFO', message, extra);
        }
      },
      error(message?: any, extra?: Record<string, any>) {
        if (!shouldLog('ERROR')) return;

        // Check if message is a function (lazy logging)
        if (typeof message === 'function') {
          lazyLogInstance.error(() => {
            const data = message();
            const { message: msg, ...extraData } = data;
            output('ERROR', msg, extraData);
            return '';
          });
        } else {
          output('ERROR', message, extra);
        }
      },
      warn(message?: any, extra?: Record<string, any>) {
        if (!shouldLog('WARN')) return;

        // Check if message is a function (lazy logging)
        if (typeof message === 'function') {
          lazyLogInstance.warn(() => {
            const data = message();
            const { message: msg, ...extraData } = data;
            output('WARN', msg, extraData);
            return '';
          });
        } else {
          output('WARN', message, extra);
        }
      },

      tag(key: string, value: string) {
        if (tags) tags[key] = value;
        return result;
      },
      clone() {
        return Log.create({ ...tags });
      },
      time(message: string, extra?: Record<string, any>) {
        const now = Date.now();
        result.info(message, { status: 'started', ...extra });
        function stop() {
          result.info(message, {
            status: 'completed',
            duration: Date.now() - now,
            ...extra,
          });
        }
        return {
          stop,
          [Symbol.dispose]() {
            stop();
          },
        };
      },
    };

    if (service && typeof service === 'string') {
      loggers.set(service, result);
    }

    return result;
  }

  /**
   * Check if JSON output mode is enabled
   */
  export function isJsonOutput(): boolean {
    return jsonOutput;
  }

  /**
   * Sync lazy logging with verbose flag at runtime
   * Call after Flag.setVerbose() to update lazy logging state
   */
  export function syncWithVerboseFlag(): void {
    if (Flag.OPENCODE_VERBOSE) {
      jsonOutput = true;
      lazyLogInstance = makeLog({
        level: levels.debug | levels.info | levels.warn | levels.error,
      });
    } else {
      lazyLogInstance = makeLog({ level: 0 });
    }
  }
}
