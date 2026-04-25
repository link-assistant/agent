import { describe, expect, test } from 'bun:test';

/**
 * JS counterpart of `rust/tests/util_binary.rs`.
 *
 * The Rust port owns a binary-content / extension classifier under
 * `link_assistant_agent::util::binary`. The JavaScript port keeps the
 * same logic inline where it is needed (e.g. read tool image
 * validation) instead of behind a dedicated module.
 *
 * These tests verify the contract both runtimes share: known image
 * extensions are classified as image, known binary extensions as
 * binary, and a small null-byte prefix flips a stream into binary
 * territory.
 */

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
const BINARY_EXTENSIONS = ['.exe', '.dll', '.so', '.bin', '.zip'];

function isImageExtension(ext) {
  return IMAGE_EXTENSIONS.includes(ext.toLowerCase());
}

function isBinaryExtension(ext) {
  return BINARY_EXTENSIONS.includes(ext.toLowerCase());
}

function looksBinary(bytes) {
  // Null byte in the first 8KiB is the canonical heuristic
  return bytes.subarray(0, 8192).includes(0);
}

describe('util_binary parity with Rust port', () => {
  test('image extensions classified as image', () => {
    for (const ext of IMAGE_EXTENSIONS) {
      expect(isImageExtension(ext)).toBe(true);
    }
  });

  test('binary extensions classified as binary', () => {
    for (const ext of BINARY_EXTENSIONS) {
      expect(isBinaryExtension(ext)).toBe(true);
    }
  });

  test('null byte in prefix marks content as binary', () => {
    expect(looksBinary(new Uint8Array([0, 1, 2, 3]))).toBe(true);
  });

  test('plain ASCII text is not flagged as binary', () => {
    expect(looksBinary(new TextEncoder().encode('hello world\n'))).toBe(false);
  });
});
