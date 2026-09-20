import { describe, expect, test } from 'bun:test';
import {
  createBusEventSubscription,
  outputBusEvent,
} from '../src/cli/event-handler.js';
import { Bus } from '../src/bus/index.ts';
import { Instance } from '../src/project/instance.ts';
import { createEventHandler } from '../src/json-standard/index.ts';
import { SessionStatus } from '../src/session/status.ts';

describe('createBusEventSubscription', () => {
  test('outputs a public idle event when the session reaches a turn boundary', async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const outputs = [];
        const { unsub, idlePromise } = createBusEventSubscription({
          sessionID: 'ses_idle',
          eventHandler: {
            output(event) {
              outputs.push(event);
            },
          },
          onError() {},
        });

        try {
          await Bus.publish(SessionStatus.Event.Idle, {
            sessionID: 'ses_idle',
          });
          await idlePromise;
        } finally {
          unsub();
        }

        expect(outputs).toContainEqual(
          expect.objectContaining({
            type: 'session_idle',
            sessionID: 'ses_idle',
          })
        );
      },
    });
  });
});

describe('outputBusEvent error events (issue #289)', () => {
  test('session.error carries a human-readable message alongside the object', () => {
    const outputs = [];
    outputBusEvent({
      event: {
        type: 'session.error',
        properties: {
          sessionID: 'ses_err',
          error: {
            name: 'RetryTimeoutExceededError',
            data: { message: 'Retry timeout exceeded after 604800s' },
          },
        },
      },
      sessionID: 'ses_err',
      eventHandler: {
        output(event) {
          outputs.push(event);
        },
      },
      onError() {},
    });

    const error = outputs.find((event) => event.type === 'error');
    expect(error.message).toBe(
      'RetryTimeoutExceededError: Retry timeout exceeded after 604800s'
    );
    // The machine-readable object is still emitted (additive change).
    expect(error.error.name).toBe('RetryTimeoutExceededError');
    expect(`${error.message}`).not.toBe('[object Object]');
  });

  test('failed tool parts carry a human-readable message', () => {
    const outputs = [];
    outputBusEvent({
      event: {
        type: 'message.part.updated',
        properties: {
          part: {
            sessionID: 'ses_tool',
            type: 'tool',
            state: { status: 'error', error: { name: 'ToolError' } },
          },
        },
      },
      sessionID: 'ses_tool',
      eventHandler: {
        output(event) {
          outputs.push(event);
        },
      },
      onError() {},
    });

    const error = outputs.find((event) => event.type === 'error');
    expect(error.message).toBe('ToolError');
  });

  test('failed tool parts without any error detail use the fallback', () => {
    const outputs = [];
    outputBusEvent({
      event: {
        type: 'message.part.updated',
        properties: {
          part: {
            sessionID: 'ses_tool2',
            type: 'tool',
            state: { status: 'error' },
          },
        },
      },
      sessionID: 'ses_tool2',
      eventHandler: {
        output(event) {
          outputs.push(event);
        },
      },
      onError() {},
    });

    const error = outputs.find((event) => event.type === 'error');
    expect(error.message).toBe('Tool execution failed');
  });
});

describe('stream-json tool lifecycle (issue #310)', () => {
  function toolUpdate(state, id = 'prt_read') {
    return {
      type: 'message.part.updated',
      properties: {
        part: {
          id,
          sessionID: 'ses_tool_lifecycle',
          messageID: 'msg_tool_lifecycle',
          type: 'tool',
          callID: `call_${id}`,
          tool: 'read',
          state,
        },
      },
    };
  }

  function captureClaudeLifecycle(states, id) {
    const output = [];
    const originalWrite = process.stdout.write;
    const originalErrorWrite = process.stderr.write;
    const capture = (chunk) => {
      output.push(String(chunk));
      return true;
    };
    process.stdout.write = capture;
    process.stderr.write = capture;

    try {
      const eventHandler = createEventHandler('claude', 'ses_tool_lifecycle');
      for (const state of states) {
        outputBusEvent({
          event: toolUpdate(state, id),
          sessionID: 'ses_tool_lifecycle',
          eventHandler,
          onError() {},
        });
      }
    } finally {
      process.stdout.write = originalWrite;
      process.stderr.write = originalErrorWrite;
    }

    return output.map((line) => JSON.parse(line));
  }

  test('emits one full-input tool_use and one terminal tool_result', () => {
    const input = { filePath: 'Cargo.toml', limit: 1 };
    const events = captureClaudeLifecycle([
      { status: 'pending', input: {}, raw: '' },
      { status: 'running', input, time: { start: 100 } },
      {
        status: 'completed',
        input,
        output: '[package]',
        title: 'Cargo.toml',
        metadata: {},
        time: { start: 100, end: 200 },
      },
    ]);

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual(
      expect.objectContaining({
        type: 'tool_use',
        name: 'read',
        input,
        tool_use_id: 'prt_read',
      })
    );
    expect(events[1]).toEqual(
      expect.objectContaining({
        type: 'tool_result',
        output: '[package]',
        status: 'success',
        tool_use_id: 'prt_read',
      })
    );
  });

  test('emits a running zero-argument tool with empty input', () => {
    const events = captureClaudeLifecycle(
      [
        { status: 'pending', input: {}, raw: '' },
        { status: 'running', input: {}, time: { start: 100 } },
        {
          status: 'completed',
          input: {},
          output: 'done',
          title: 'Done',
          metadata: {},
          time: { start: 100, end: 200 },
        },
      ],
      'prt_zero'
    );

    expect(events.map((event) => event.type)).toEqual([
      'tool_use',
      'tool_result',
    ]);
    expect(events[0].input).toEqual({});
    expect(events[0].tool_use_id).toBe('prt_zero');
    expect(events[1].tool_use_id).toBe('prt_zero');
  });

  test('deduplicates populated pending and running snapshots', () => {
    const input = { filePath: 'README.md' };
    const events = captureClaudeLifecycle(
      [
        { status: 'pending', input, raw: '{"filePath":"README.md"}' },
        { status: 'running', input, time: { start: 100 } },
        {
          status: 'completed',
          input,
          output: '# Agent',
          title: 'README.md',
          metadata: {},
          time: { start: 100, end: 200 },
        },
      ],
      'prt_populated_pending'
    );

    expect(events.map((event) => event.type)).toEqual([
      'tool_use',
      'tool_result',
    ]);
    expect(events[0].input).toEqual(input);
    expect(events[0].tool_use_id).toBe('prt_populated_pending');
    expect(events[1].tool_use_id).toBe('prt_populated_pending');
  });

  test('emits one terminal error result for a failed tool', () => {
    const input = { filePath: 'missing.txt' };
    const events = captureClaudeLifecycle(
      [
        { status: 'pending', input: {}, raw: '' },
        { status: 'running', input, time: { start: 100 } },
        {
          status: 'error',
          input,
          error: 'File not found',
          time: { start: 100, end: 200 },
        },
      ],
      'prt_error'
    );

    expect(events.map((event) => event.type)).toEqual([
      'tool_use',
      'tool_result',
    ]);
    expect(events[1]).toEqual(
      expect.objectContaining({
        type: 'tool_result',
        output: 'File not found',
        status: 'error',
        tool_use_id: 'prt_error',
      })
    );
  });
});
