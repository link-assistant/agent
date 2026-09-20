/**
 * JSON Standard Format Handlers
 *
 * Provides adapters for different JSON output formats:
 * - opencode: OpenCode format (default) - configurable JSON formatting
 * - claude: Claude CLI stream-json format - NDJSON (newline-delimited JSON)
 *
 * Output goes to stdout for normal messages, stderr for errors.
 * Use LINK_ASSISTANT_AGENT_COMPACT_JSON env var or --compact-json flag for NDJSON output.
 */

import { EOL } from 'os';
import { config } from '../config/config';

export type JsonStandard = 'opencode' | 'claude';

/**
 * OpenCode JSON event types
 */
export interface OpenCodeEvent {
  type:
    | 'step_start'
    | 'step_finish'
    | 'text'
    | 'tool_use'
    | 'error'
    | 'session_idle';
  timestamp: number;
  sessionID: string;
  part?: Record<string, unknown>;
  message?: string;
  error?: string | Record<string, unknown>;
}

/**
 * Claude JSON event types (stream-json format)
 */
export interface ClaudeEvent {
  type: 'init' | 'message' | 'tool_use' | 'tool_result' | 'result' | 'idle';
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
 * Respects LINK_ASSISTANT_AGENT_COMPACT_JSON env var for OpenCode format
 */
export function serializeOutput(
  event: OpenCodeEvent | ClaudeEvent,
  standard: JsonStandard
): string {
  if (standard === 'claude') {
    // NDJSON format - always compact, one line
    return JSON.stringify(event) + EOL;
  }
  // OpenCode format - compact if LINK_ASSISTANT_AGENT_COMPACT_JSON is set
  if (config.compactJson) {
    return JSON.stringify(event) + EOL;
  }
  return JSON.stringify(event, null, 2) + EOL;
}

/**
 * Convert OpenCode event to Claude event format
 *
 * @param model - Resolved `providerID/modelID`, reported on the `init` event so
 *   Claude-standard consumers see which model the run settled on (#295)
 */
export function convertOpenCodeToClaude(
  event: OpenCodeEvent,
  startTime: number,
  model?: string
): ClaudeEvent | null {
  const timestamp = new Date(event.timestamp).toISOString();
  const session_id = event.sessionID;

  switch (event.type) {
    case 'step_start':
      return {
        type: 'init',
        timestamp,
        session_id,
        ...(model ? { model } : {}),
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
        const input = state.input || {};
        const status = state.status as string | undefined;

        // A newly-created pending part has not received its parsed arguments
        // yet. Populated pending parts are retained for compatibility with
        // producers that publish the complete call in their first snapshot.
        if (
          status === 'pending' &&
          typeof input === 'object' &&
          input !== null &&
          Object.keys(input).length === 0
        ) {
          return null;
        }

        if (status === 'completed') {
          return {
            type: 'tool_result',
            timestamp,
            session_id,
            tool_use_id: event.part.id as string,
            output: state.output as string,
            status: 'success',
          };
        }

        // outputBusEvent follows an errored tool snapshot with an error event
        // carrying the same part, which is converted to the terminal result.
        if (status === 'error') {
          return null;
        }

        return {
          type: 'tool_use',
          timestamp,
          session_id,
          name: (event.part.tool as string) || 'unknown',
          input,
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

    case 'session_idle':
      return {
        type: 'idle',
        timestamp,
        session_id,
      };

    case 'error':
      if (event.part?.type === 'tool' && event.part.state) {
        const state = event.part.state as Record<string, unknown>;
        return {
          type: 'tool_result',
          timestamp,
          session_id,
          tool_use_id: event.part.id as string,
          output:
            event.message ||
            (typeof state.error === 'string'
              ? state.error
              : 'Tool execution failed'),
          status: 'error',
        };
      }
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
 *
 * @param options.model - Resolved `providerID/modelID` for the run; carried on
 *   the Claude `init` event (#295)
 */
export function createEventHandler(
  standard: JsonStandard,
  sessionID: string,
  options: { model?: string } = {}
) {
  const startTime = Date.now();
  const { model } = options;
  const emittedToolUseIds = new Set<string>();
  const emittedToolResultIds = new Set<string>();

  return {
    /**
     * Format and output an event
     */
    output(event: OpenCodeEvent): void {
      const outputStream =
        event.type === 'error' ? process.stderr : process.stdout;
      if (standard === 'claude') {
        const claudeEvent = convertOpenCodeToClaude(event, startTime, model);
        if (claudeEvent) {
          if (claudeEvent.type === 'tool_use' && claudeEvent.tool_use_id) {
            if (emittedToolUseIds.has(claudeEvent.tool_use_id)) return;
            emittedToolUseIds.add(claudeEvent.tool_use_id);
          }
          if (claudeEvent.type === 'tool_result' && claudeEvent.tool_use_id) {
            if (emittedToolResultIds.has(claudeEvent.tool_use_id)) return;
            emittedToolResultIds.add(claudeEvent.tool_use_id);
          }
          outputStream.write(serializeOutput(claudeEvent, standard));
        }
      } else {
        outputStream.write(serializeOutput(event, standard));
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
