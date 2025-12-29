import { NamedError } from '../util/error';
import z from 'zod';

export namespace UI {
  // ANSI color codes for terminal output
  export const Style = {
    TEXT_NORMAL: '\x1b[0m',
    TEXT_BOLD: '\x1b[1m',
    TEXT_DIM: '\x1b[2m',
    TEXT_DANGER_BOLD: '\x1b[1;31m',
    TEXT_SUCCESS_BOLD: '\x1b[1;32m',
    TEXT_WARNING_BOLD: '\x1b[1;33m',
    TEXT_INFO_BOLD: '\x1b[1;34m',
    TEXT_HIGHLIGHT_BOLD: '\x1b[1;35m',
    TEXT_DIM_BOLD: '\x1b[1;90m',
  } as const;

  // Error for cancelled operations (e.g., Ctrl+C in prompts)
  export const CancelledError = NamedError.create(
    'CancelledError',
    z.object({})
  );

  // Print an empty line
  export function empty() {
    process.stderr.write('\n');
  }

  // Print a line with optional formatting
  export function println(...args: string[]) {
    process.stderr.write(args.join('') + Style.TEXT_NORMAL + '\n');
  }

  // Print an error message
  export function error(message: string) {
    process.stderr.write(
      Style.TEXT_DANGER_BOLD + 'Error: ' + Style.TEXT_NORMAL + message + '\n'
    );
  }

  // Print a success message
  export function success(message: string) {
    process.stderr.write(
      Style.TEXT_SUCCESS_BOLD + 'Success: ' + Style.TEXT_NORMAL + message + '\n'
    );
  }

  // Print an info message
  export function info(message: string) {
    process.stderr.write(
      Style.TEXT_INFO_BOLD + 'Info: ' + Style.TEXT_NORMAL + message + '\n'
    );
  }

  // Basic markdown rendering for terminal
  export function markdown(text: string): string {
    // Simple markdown to ANSI conversion
    let result = text;

    // Bold text: **text** or __text__
    result = result.replace(
      /\*\*(.+?)\*\*/g,
      Style.TEXT_BOLD + '$1' + Style.TEXT_NORMAL
    );
    result = result.replace(
      /__(.+?)__/g,
      Style.TEXT_BOLD + '$1' + Style.TEXT_NORMAL
    );

    // Code blocks: `code`
    result = result.replace(
      /`([^`]+)`/g,
      Style.TEXT_DIM + '$1' + Style.TEXT_NORMAL
    );

    return result;
  }
}
