import { test, expect, describe } from 'bun:test';
import { formatJson, type OutputMessage } from '../src/cli/output';

/**
 * Unit tests for safe JSON serialization.
 *
 * Issue #200: All output should be JSON-only, including errors with
 * cyclic references. The formatJson function must never throw or produce
 * non-JSON output.
 *
 * @see https://github.com/link-assistant/agent/issues/200
 */

describe('formatJson - safe JSON serialization', () => {
  test('serializes simple messages', () => {
    const msg: OutputMessage = {
      type: 'status',
      message: 'hello',
    };
    const result = formatJson(msg, true);
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe('status');
    expect(parsed.message).toBe('hello');
  });

  test('handles cyclic references without throwing', () => {
    const obj: any = { type: 'error', message: 'test' };
    obj.self = obj; // Cyclic reference
    const result = formatJson(obj as OutputMessage, true);
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe('error');
    expect(parsed.self).toBe('[Circular]');
  });

  test('serializes Error objects in error field', () => {
    const error = new Error('test error');
    error.name = 'TestError';
    const msg: OutputMessage = {
      type: 'error',
      error: error as unknown,
    };
    const result = formatJson(msg, true);
    const parsed = JSON.parse(result);
    expect(parsed.error.name).toBe('TestError');
    expect(parsed.error.message).toBe('test error');
    expect(typeof parsed.error.stack).toBe('string');
  });

  test('handles nested cyclic references', () => {
    const a: any = { name: 'a' };
    const b: any = { name: 'b', parent: a };
    a.child = b;
    const msg: OutputMessage = {
      type: 'status',
      data: a,
    };
    const result = formatJson(msg, true);
    const parsed = JSON.parse(result);
    expect(parsed.data.name).toBe('a');
    expect(parsed.data.child.name).toBe('b');
    expect(parsed.data.child.parent).toBe('[Circular]');
  });

  test('handles undefined and null values', () => {
    const msg: OutputMessage = {
      type: 'status',
      nullVal: null,
      undefinedVal: undefined,
    };
    const result = formatJson(msg, true);
    const parsed = JSON.parse(result);
    expect(parsed.nullVal).toBeNull();
    // undefined values are omitted by JSON.stringify
    expect(parsed.undefinedVal).toBeUndefined();
  });

  test('compact mode produces single-line JSON', () => {
    const msg: OutputMessage = {
      type: 'status',
      message: 'test',
    };
    const compact = formatJson(msg, true);
    const pretty = formatJson(msg, false);
    expect(compact.includes('\n')).toBe(false);
    expect(pretty.includes('\n')).toBe(true);
  });

  test('handles Error with cause chain', () => {
    const cause = new Error('root cause');
    const error = new Error('wrapper error', { cause });
    const msg: OutputMessage = {
      type: 'error',
      error: error as unknown,
    };
    const result = formatJson(msg, true);
    const parsed = JSON.parse(result);
    expect(parsed.error.message).toBe('wrapper error');
    expect(parsed.error.cause.message).toBe('root cause');
  });
});
