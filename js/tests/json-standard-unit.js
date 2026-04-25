import { test, expect, describe } from 'bun:test';
import {
  serializeOutput,
  convertOpenCodeToClaude,
  createEventHandler,
  isValidJsonStandard,
} from '../src/json-standard/index.ts';

describe('JSON Standard Module - Unit Tests', () => {
  describe('isValidJsonStandard', () => {
    test('accepts "opencode"', () => {
      expect(isValidJsonStandard('opencode')).toBe(true);
    });

    test('accepts "claude"', () => {
      expect(isValidJsonStandard('claude')).toBe(true);
    });

    test('rejects invalid values', () => {
      expect(isValidJsonStandard('invalid')).toBe(false);
      expect(isValidJsonStandard('')).toBe(false);
      expect(isValidJsonStandard('OPENCODE')).toBe(false); // Case sensitive
      expect(isValidJsonStandard('CLAUDE')).toBe(false);
    });
  });

  describe('serializeOutput', () => {
    const sampleEvent = {
      type: 'step_start',
      timestamp: 1234567890000,
      sessionID: 'ses_test123',
    };

    test('opencode format produces pretty-printed JSON', () => {
      const output = serializeOutput(sampleEvent, 'opencode');

      // Should have newlines (pretty-printed)
      expect(output.split('\n').length).toBeGreaterThan(1);

      // Should have indentation
      expect(output.includes('  ')).toBe(true);

      // Should end with newline
      expect(output.endsWith('\n')).toBe(true);
    });

    test('claude format produces compact JSON (NDJSON)', () => {
      const output = serializeOutput(sampleEvent, 'claude');

      // Should be a single line (plus final newline)
      const lines = output.trim().split('\n');
      expect(lines.length).toBe(1);

      // Should not have indentation
      expect(output.includes('  ')).toBe(false);

      // Should end with newline
      expect(output.endsWith('\n')).toBe(true);
    });

    test('both formats produce valid JSON', () => {
      const opencodeOutput = serializeOutput(sampleEvent, 'opencode');
      const claudeOutput = serializeOutput(sampleEvent, 'claude');

      expect(() => JSON.parse(opencodeOutput)).not.toThrow();
      expect(() => JSON.parse(claudeOutput)).not.toThrow();
    });
  });

  describe('convertOpenCodeToClaude', () => {
    const startTime = Date.now();

    test('converts step_start to init', () => {
      const opencodeEvent = {
        type: 'step_start',
        timestamp: startTime + 100,
        sessionID: 'ses_test123',
        part: { id: 'prt_test123' },
      };

      const claudeEvent = convertOpenCodeToClaude(opencodeEvent, startTime);

      expect(claudeEvent).not.toBeNull();
      expect(claudeEvent.type).toBe('init');
      expect(claudeEvent.session_id).toBe('ses_test123');
      expect(claudeEvent.timestamp).toBeDefined();
      // Timestamp should be ISO 8601
      expect(new Date(claudeEvent.timestamp).toISOString()).toBe(
        claudeEvent.timestamp
      );
    });

    test('converts text to message', () => {
      const opencodeEvent = {
        type: 'text',
        timestamp: startTime + 100,
        sessionID: 'ses_test123',
        part: {
          id: 'prt_test123',
          text: 'Hello, world!',
        },
      };

      const claudeEvent = convertOpenCodeToClaude(opencodeEvent, startTime);

      expect(claudeEvent).not.toBeNull();
      expect(claudeEvent.type).toBe('message');
      expect(claudeEvent.role).toBe('assistant');
      expect(claudeEvent.session_id).toBe('ses_test123');
      expect(Array.isArray(claudeEvent.content)).toBe(true);
      expect(claudeEvent.content[0]).toEqual({
        type: 'text',
        text: 'Hello, world!',
      });
    });

    test('converts tool_use to tool_use', () => {
      const opencodeEvent = {
        type: 'tool_use',
        timestamp: startTime + 100,
        sessionID: 'ses_test123',
        part: {
          id: 'prt_tool123',
          state: {
            tool: {
              name: 'bash',
              parameters: { command: 'ls' },
            },
          },
        },
      };

      const claudeEvent = convertOpenCodeToClaude(opencodeEvent, startTime);

      expect(claudeEvent).not.toBeNull();
      expect(claudeEvent.type).toBe('tool_use');
      expect(claudeEvent.name).toBe('bash');
      expect(claudeEvent.input).toEqual({ command: 'ls' });
      expect(claudeEvent.tool_use_id).toBe('prt_tool123');
    });

    test('converts step_finish to result', () => {
      const opencodeEvent = {
        type: 'step_finish',
        timestamp: startTime + 1000, // 1 second later
        sessionID: 'ses_test123',
        part: { id: 'prt_test123' },
      };

      const claudeEvent = convertOpenCodeToClaude(opencodeEvent, startTime);

      expect(claudeEvent).not.toBeNull();
      expect(claudeEvent.type).toBe('result');
      expect(claudeEvent.status).toBe('success');
      expect(claudeEvent.session_id).toBe('ses_test123');
      expect(claudeEvent.duration_ms).toBe(1000);
    });

    test('converts error to result with error status', () => {
      const opencodeEvent = {
        type: 'error',
        timestamp: startTime + 100,
        sessionID: 'ses_test123',
        error: 'Something went wrong',
      };

      const claudeEvent = convertOpenCodeToClaude(opencodeEvent, startTime);

      expect(claudeEvent).not.toBeNull();
      expect(claudeEvent.type).toBe('result');
      expect(claudeEvent.status).toBe('error');
      expect(claudeEvent.output).toBe('Something went wrong');
    });

    test('returns null for text without content', () => {
      const opencodeEvent = {
        type: 'text',
        timestamp: startTime + 100,
        sessionID: 'ses_test123',
        part: { id: 'prt_test123' }, // No text field
      };

      const claudeEvent = convertOpenCodeToClaude(opencodeEvent, startTime);
      expect(claudeEvent).toBeNull();
    });

    test('uses snake_case session_id instead of camelCase sessionID', () => {
      const opencodeEvent = {
        type: 'step_start',
        timestamp: startTime + 100,
        sessionID: 'ses_test123',
        part: { id: 'prt_test123' },
      };

      const claudeEvent = convertOpenCodeToClaude(opencodeEvent, startTime);

      expect(claudeEvent.session_id).toBe('ses_test123');
      expect(claudeEvent.sessionID).toBeUndefined();
    });
  });

  describe('createEventHandler', () => {
    test('creates handler with correct startTime', () => {
      const beforeTime = Date.now();
      const handler = createEventHandler('opencode', 'ses_test123');
      const afterTime = Date.now();

      const startTime = handler.getStartTime();
      expect(startTime).toBeGreaterThanOrEqual(beforeTime);
      expect(startTime).toBeLessThanOrEqual(afterTime);
    });

    test('handler.output exists and is a function', () => {
      const handler = createEventHandler('opencode', 'ses_test123');
      expect(typeof handler.output).toBe('function');
    });
  });
});

describe('JSON Standard Comparison Tests', () => {
  test('opencode and claude formats produce different output for same event', () => {
    const event = {
      type: 'step_start',
      timestamp: Date.now(),
      sessionID: 'ses_test123',
      part: { id: 'prt_test123' },
    };

    const opencodeOutput = serializeOutput(event, 'opencode');
    const claudeOutput = serializeOutput(event, 'claude');

    expect(opencodeOutput).not.toBe(claudeOutput);
  });

  test('opencode preserves original event structure', () => {
    const event = {
      type: 'step_start',
      timestamp: 1234567890000,
      sessionID: 'ses_test123',
      part: { id: 'prt_test123' },
    };

    const output = serializeOutput(event, 'opencode');
    const parsed = JSON.parse(output);

    expect(parsed.type).toBe('step_start');
    expect(parsed.timestamp).toBe(1234567890000);
    expect(parsed.sessionID).toBe('ses_test123');
    expect(parsed.part.id).toBe('prt_test123');
  });
});
