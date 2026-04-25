import { describe, expect, test } from 'bun:test';
import { resolve, relative } from 'node:path';

/**
 * JS counterpart of `rust/tests/util_filesystem.rs`.
 *
 * The Rust port exposes `Filesystem::contains`, `Filesystem::overlaps`,
 * `Filesystem::find_up`, and `Filesystem::relative` (see
 * `rust/src/util/filesystem.rs`). The JavaScript port leans on Node's
 * `node:path` module, which provides the same primitives.
 *
 * These tests verify the contract both runtimes share: relative path
 * computation between two absolute paths, and the in-vs-out
 * containment check the Rust suite exercises.
 */

function pathContains(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
}

describe('util_filesystem parity with Rust port', () => {
  test('relative path between two absolute paths', () => {
    const r = relative('/tmp/a', '/tmp/a/b');
    expect(r).toBe('b');
  });

  test('relative path goes up when target is above base', () => {
    const r = relative('/tmp/a/b', '/tmp/a');
    expect(r).toBe('..');
  });

  test('contains returns true when child sits under parent', () => {
    expect(pathContains('/tmp', '/tmp/sessions')).toBe(true);
  });

  test('contains returns false when paths are unrelated', () => {
    expect(pathContains('/tmp', '/var/data')).toBe(false);
  });
});
