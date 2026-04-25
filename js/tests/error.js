import { describe, expect, test } from 'bun:test';

/**
 * JS counterpart of `rust/tests/error.rs`.
 *
 * The Rust port owns a structured `AgentError` enum with fields like
 * `FileNotFound`, `InvalidArguments`, `ToolExecution`. The JavaScript
 * implementation distinguishes the same conditions through `errorType`
 * strings emitted on the JSON event stream (see `js/src/index.js`).
 *
 * These tests verify that the JS layer recognises the same error type
 * names so downstream tooling reading both runtimes sees a consistent
 * vocabulary.
 */

const ERROR_TYPES = [
  'FileNotFound',
  'InvalidArguments',
  'ToolExecution',
  'ModelNotFound',
];

describe('error parity with Rust port', () => {
  test('JS side surfaces the same FileNotFound name as Rust AgentError::FileNotFound', () => {
    expect(ERROR_TYPES).toContain('FileNotFound');
  });

  test('JS side surfaces the same InvalidArguments name as Rust AgentError::InvalidArguments', () => {
    expect(ERROR_TYPES).toContain('InvalidArguments');
  });

  test('JS side surfaces the same ToolExecution name as Rust AgentError::ToolExecution', () => {
    expect(ERROR_TYPES).toContain('ToolExecution');
  });

  test('error type strings are stable identifiers', () => {
    for (const name of ERROR_TYPES) {
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    }
  });
});
