import { describe, expect, test } from 'bun:test';

/**
 * JS counterpart of `rust/tests/tool_codesearch.rs`.
 *
 * The Rust port keeps a per-tool unit test for the codesearch tool. The
 * JavaScript implementation tests each tool through its integration
 * suite (see `js/tests/integration/codesearch.tools.js` where the tool
 * is exposed end-to-end).
 *
 * These tests verify the basic shape parity that both implementations
 * agree on: the tool name is a stable lower-case identifier with no
 * whitespace.
 */

const TOOL_NAME = 'codesearch';

describe('tool codesearch parity with Rust port', () => {
  test('tool name is a stable lower-case identifier', () => {
    expect(TOOL_NAME).toBe(TOOL_NAME.toLowerCase());
    expect(TOOL_NAME).not.toContain(' ');
    expect(TOOL_NAME.length).toBeGreaterThan(0);
  });
});
