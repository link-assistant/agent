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
 */
let globalCompactJson = false;

/**
 * Set the global compact JSON setting
 */
export function setCompactJson(compact: boolean): void {
  globalCompactJson = compact;
}

/**
 * Get the current compact JSON setting
 */
export function isCompactJson(): boolean {
  return globalCompactJson;
}

/**
 * Format a message as JSON string
 * @param message - The message object to format
 * @param compact - Override the global compact setting
 */
export function formatJson(
  message: OutputMessage,
  compact?: boolean
): string {
  const useCompact = compact ?? globalCompactJson;
  return useCompact
    ? JSON.stringify(message)
    : JSON.stringify(message, null, 2);
}

/**
 * Write a message to stdout (for normal output)
 * @param message - The message object to output
 * @param compact - Override the global compact setting
 */
export function writeStdout(
  message: OutputMessage,
  compact?: boolean
): void {
  const json = formatJson(message, compact);
  process.stdout.write(json + EOL);
}

/**
 * Write a message to stderr (for errors only)
 * @param message - The message object to output
 * @param compact - Override the global compact setting
 */
export function writeStderr(
  message: OutputMessage,
  compact?: boolean
): void {
  const json = formatJson(message, compact);
  process.stderr.write(json + EOL);
}

/**
 * Output a message to the appropriate stream based on type
 * - Errors go to stderr
 * - Everything else goes to stdout
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

/**
 * Output a status message to stdout
 */
export function outputStatus(
  status: Omit<OutputMessage, 'type'> & { type?: 'status' | 'error' | 'warning' },
  compact?: boolean
): void {
  const message: OutputMessage = {
    type: 'status',
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
