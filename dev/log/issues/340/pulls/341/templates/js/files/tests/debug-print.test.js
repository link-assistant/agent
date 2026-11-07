import { describe, it, expect } from 'test-anywhere';

import {
  debugWith,
  formatDebugLines,
  isDebugEnabled,
  readEnvVar,
} from '../scripts/debug-print.mjs';

/**
 * Environment source that denies reads, mirroring how Deno rejects
 * `process.env` access when the run was not granted `--allow-env`.
 */
const deniedEnv = new Proxy(
  {},
  {
    get() {
      throw new Error('NotCapable: Requires env access');
    },
  }
);

describe('debug-print', () => {
  it('stays off by default', () => {
    expect(isDebugEnabled({})).toBe(false);
  });

  it('honours each documented activation switch', () => {
    expect(isDebugEnabled({ CI_SCRIPTS_DEBUG: '1' })).toBe(true);
    expect(isDebugEnabled({ CI_SCRIPTS_DEBUG: 'true' })).toBe(true);
    expect(isDebugEnabled({ RUNNER_DEBUG: '1' })).toBe(true);
    expect(isDebugEnabled({ ACTIONS_STEP_DEBUG: 'true' })).toBe(true);
  });

  it('ignores unrelated values', () => {
    expect(isDebugEnabled({ CI_SCRIPTS_DEBUG: '0' })).toBe(false);
    expect(isDebugEnabled({ RUNNER_DEBUG: 'false' })).toBe(false);
  });

  it('reports an unreadable environment variable as unset', () => {
    expect(readEnvVar('CI_SCRIPTS_DEBUG', deniedEnv)).toBe(undefined);
    expect(isDebugEnabled(deniedEnv)).toBe(false);
  });

  it('prints nothing while disabled', () => {
    const lines = [];
    debugWith(
      { env: {}, log: (line) => lines.push(line) },
      'should not appear'
    );
    expect(lines).toEqual([]);
  });

  it('prefixes every line with ::debug:: while enabled', () => {
    const lines = [];
    debugWith(
      { env: { CI_SCRIPTS_DEBUG: '1' }, log: (line) => lines.push(line) },
      'shape',
      { keys: ['default'] }
    );
    expect(lines.length > 1).toBe(true);
    expect(lines.every((line) => line.startsWith('::debug::'))).toBe(true);
    expect(lines[0]).toBe('::debug::shape {');
  });

  it('renders multi-line values without printing them', () => {
    expect(formatDebugLines(['a', { b: 1 }])).toEqual([
      '::debug::a {',
      '::debug::  "b": 1',
      '::debug::}',
    ]);
  });
});
