import { describe, expect, test } from 'bun:test';
import { ulid } from 'ulid';

/**
 * JS counterpart of `rust/tests/id.rs`.
 *
 * The Rust port exposes ULID/UUID generation helpers under
 * `link_assistant_agent::id`. The JavaScript implementation uses the
 * upstream `ulid` package directly.
 *
 * These tests verify the same ULID guarantees the Rust suite checks:
 * fixed-length canonical encoding, monotonic ordering, character set.
 */

const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;

describe('id parity with Rust port', () => {
  test('ulid() returns a 26-character canonical ULID', () => {
    const value = ulid();
    expect(value).toMatch(ULID_REGEX);
    expect(value.length).toBe(26);
  });

  test('ulid() generates unique values', () => {
    const values = new Set();
    for (let i = 0; i < 100; i += 1) {
      values.add(ulid());
    }
    expect(values.size).toBe(100);
  });

  test('ulid() lexicographic order tracks creation time', async () => {
    const a = ulid();
    await new Promise((resolve) => setTimeout(resolve, 2));
    const b = ulid();
    expect(a < b).toBe(true);
  });
});
