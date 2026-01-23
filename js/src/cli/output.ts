/**
 * CLI Output Module
 *
 * Centralized output handling for the Agent CLI.
 * Ensures consistent JSON formatting and proper stream routing:
 * - stdout: Normal output (status, events, data)
 * - stderr: Errors only
 *
 * All output includes a `type` field for easy parsing.
 */

import { EOL } from 'os';
import { Flag } from '../flag/flag.ts';

/**
 * Output types for JSON messages
 */
export type OutputType =
  | 'status'
  | 'error'
  | 'warning'
  | 'log'
  | 'step_start'
  | 'step_finish'
  | 'text'
  | 'tool_use'
  | 'result'
  | 'init'
  | 'message'
  | 'tool_result'
  | 'input';

/**
 * Base interface for all output messages
 */
export interface OutputMessage {
  type: OutputType;
  [key: string]: unknown;
}

/**
 * Global compact JSON setting (can be set once at startup)
 * Initialized lazily from Flag.COMPACT_JSON() which checks AGENT_CLI_COMPACT env var
 */
let globalCompactJson: boolean | null = null;

/**
 * Set the global compact JSON setting
 */
export function setCompactJson(compact: boolean): void {
  globalCompactJson = compact;
  // Also update the Flag so other modules stay in sync
  Flag.setCompactJson(compact);
}

/**
 * Get the current compact JSON setting
 */
export function isCompactJson(): boolean {
  if (globalCompactJson !== null) return globalCompactJson;
  return Flag.COMPACT_JSON();
}

/**
 * Format a message as JSON string
 * @param message - The message object to format
 * @param compact - Override the global compact setting
 */
export function formatJson(message: OutputMessage, compact?: boolean): string {
  // Check local, global, and Flag settings for compact mode
  const useCompact = compact ?? isCompactJson();
  return useCompact
    ? JSON.stringify(message)
    : JSON.stringify(message, null, 2);
}

/**
 * Write a message to stdout (for normal output)
 * @param message - The message object to output
 * @param compact - Override the global compact setting
 */
export function writeStdout(message: OutputMessage, compact?: boolean): void {
  const json = formatJson(message, compact);
  process.stdout.write(json + EOL);
}

/**
 * Write a message to stderr (for errors only)
 * @param message - The message object to output
 * @param compact - Override the global compact setting
 */
export function writeStderr(message: OutputMessage, compact?: boolean): void {
  const json = formatJson(message, compact);
  process.stderr.write(json + EOL);
}

/**
 * Output a message to the appropriate stream based on type
 * - stdout: All output except errors (status, events, data, logs, warnings)
 * - stderr: Errors only
 *
 * @param message - The message object to output
 * @param compact - Override the global compact setting
 */
export function output(message: OutputMessage, compact?: boolean): void {
  if (message.type === 'error') {
    writeStderr(message, compact);
  } else {
    writeStdout(message, compact);
  }
}
}

/**
 * Output a status message to stdout
 */
export function outputStatus(
  status: Omit<OutputMessage, 'type'> & {
    type?: 'status' | 'error' | 'warning';
  },
  compact?: boolean
): void {
  const message: OutputMessage = {
    type: status.type || 'status',
    ...status,
  };
  output(message, compact);
}

/**
 * Output an error message to stderr
 */
export function outputError(
  error: {
    errorType?: string;
    message: string;
    hint?: string;
    stack?: string;
    [key: string]: unknown;
  },
  compact?: boolean
): void {
  const message: OutputMessage = {
    type: 'error',
    ...error,
  };
  writeStderr(message, compact);
}

/**
 * Output a warning message to stdout
 */
export function outputWarning(
  warning: {
    message: string;
    hint?: string;
    [key: string]: unknown;
  },
  compact?: boolean
): void {
  const message: OutputMessage = {
    type: 'warning',
    ...warning,
  };
  writeStdout(message, compact);
}

/**
 * Output a log message to stdout
 * This uses the flattened format: { "type": "log", "level": "info", ... }
 */
export function outputLog(
  log: {
    level: 'debug' | 'info' | 'warn' | 'error';
    message?: string;
    timestamp?: string;
    [key: string]: unknown;
  },
  compact?: boolean
): void {
  const message: OutputMessage = {
    type: 'log',
    ...log,
  };
  writeStdout(message, compact);
}

/**
 * Output user input confirmation to stdout
 */
export function outputInput(
  input: {
    raw: string;
    parsed?: unknown;
    format?: 'json' | 'text';
    [key: string]: unknown;
  },
  compact?: boolean
): void {
  const message: OutputMessage = {
    type: 'input',
    timestamp: new Date().toISOString(),
    ...input,
  };
  writeStdout(message, compact);
}

// Re-export for backward compatibility
export { output as write };
