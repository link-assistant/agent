/**
 * JSON Standard Format Handlers
 *
 * Provides adapters for different JSON output formats:
 * - opencode: OpenCode format (default) - pretty-printed JSON events
 * - claude: Claude CLI stream-json format - NDJSON (newline-delimited JSON)
 */

import { EOL } from 'os';

export type JsonStandard = 'opencode' | 'claude';

/**
 * OpenCode JSON event types
 */
export interface OpenCodeEvent {
  type: 'step_start' | 'step_finish' | 'text' | 'tool_use' | 'error';
  timestamp: number;
  sessionID: string;
  part?: Record<string, unknown>;
  error?: string | Record<string, unknown>;
}

/**
 * Claude JSON event types (stream-json format)
 */
export interface ClaudeEvent {
  type: 'init' | 'message' | 'tool_use' | 'tool_result' | 'result';
  timestamp?: string;
  session_id?: string;
  role?: 'assistant' | 'user';
  content?: Array<{
    type: 'text' | 'tool_use';
    text?: string;
    name?: string;
    input?: unknown;
  }>;
  output?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  status?: 'success' | 'error';
  duration_ms?: number;
  model?: string;
}

/**
 * Serialize JSON output based on the selected standard
 */
export function serializeOutput(
  event: OpenCodeEvent | ClaudeEvent,
  standard: JsonStandard
): string {
  if (standard === 'claude') {
    // NDJSON format - compact, one line
    return JSON.stringify(event) + EOL;
  }
  // OpenCode format - pretty-printed
  return JSON.stringify(event, null, 2) + EOL;
}

/**
 * Convert OpenCode event to Claude event format
 */
export function convertOpenCodeToClaude(
  event: OpenCodeEvent,
  startTime: number
): ClaudeEvent | null {
  const timestamp = new Date(event.timestamp).toISOString();
  const session_id = event.sessionID;

  switch (event.type) {
    case 'step_start':
      return {
        type: 'init',
        timestamp,
        session_id,
      };

    case 'text':
      if (event.part && typeof event.part.text === 'string') {
        return {
          type: 'message',
          timestamp,
          session_id,
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: event.part.text,
            },
          ],
        };
      }
      return null;

    case 'tool_use':
      if (event.part && event.part.state) {
        const state = event.part.state as Record<string, unknown>;
        const tool = state.tool as Record<string, unknown> | undefined;
        return {
          type: 'tool_use',
          timestamp,
          session_id,
          name: (tool?.name as string) || 'unknown',
          input: tool?.parameters || {},
          tool_use_id: event.part.id as string,
        };
      }
      return null;

    case 'step_finish':
      return {
        type: 'result',
        timestamp,
        session_id,
        status: 'success',
        duration_ms: event.timestamp - startTime,
      };

    case 'error':
      return {
        type: 'result',
        timestamp,
        session_id,
        status: 'error',
        output:
          typeof event.error === 'string'
            ? event.error
            : JSON.stringify(event.error),
      };

    default:
      return null;
  }
}

/**
 * Create an event output handler based on the selected standard
 */
export function createEventHandler(standard: JsonStandard, sessionID: string) {
  const startTime = Date.now();

  return {
    /**
     * Format and output an event
     */
    output(event: OpenCodeEvent): void {
      if (standard === 'claude') {
        const claudeEvent = convertOpenCodeToClaude(event, startTime);
        if (claudeEvent) {
          process.stdout.write(serializeOutput(claudeEvent, standard));
        }
      } else {
        process.stdout.write(serializeOutput(event, standard));
      }
    },

    /**
     * Get the start time for duration calculations
     */
    getStartTime(): number {
      return startTime;
    },
  };
}

/**
 * Validate JSON standard option
 */
export function isValidJsonStandard(value: string): value is JsonStandard {
  return value === 'opencode' || value === 'claude';
}
