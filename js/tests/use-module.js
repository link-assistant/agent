/**
 * Regression tests for scripts/use-module.mjs.
 *
 * Production failure they cover (issue #301): the "Release" job of the JS
 * pipeline died with `Error updating npm: $ is not a function` on
 * 2026-09-01 (run 33551125228). The runner uses Node.js 24, which adds a
 * synthetic `'module.exports'` named export to every CommonJS namespace
 * (https://nodejs.org/api/esm.html#commonjs-namespaces). `use-m@8.15.0` treats
 * that marker as a real named export and stops unwrapping the callable
 * CommonJS default, so `const { $ } = await use('command-stream')` — after
 * command-stream@0.19.0 added a CommonJS entry point — resolved to `undefined`.
 *
 * Upstream report: https://github.com/link-foundation/use-m/issues/72
 */

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';

import {
  configureModule,
  normalizeModule,
  useModule,
} from '../../scripts/use-module.mjs';

/**
 * The exact namespace Node.js 24 hands back for command-stream@0.19.0: only the
 * callable default and the interop marker, with the named exports (`$`, `sh`,
 * …) reachable solely as properties of that callable.
 */
const makeNode24CommandStreamNamespace = () => {
  const shell = () => 'ran';
  shell.$ = shell;
  shell.sh = shell;
  shell.run = () => 'ran';
  return { default: shell, 'module.exports': shell };
};

/** What Node.js 20 hands back for the same package: named exports at top level. */
const makeNode20CommandStreamNamespace = () => {
  const shell = () => 'ran';
  shell.$ = shell;
  return { $: shell, sh: shell, default: shell };
};

describe('normalizeModule', () => {
  test('hoists named exports off the Node 24 CommonJS interop marker', () => {
    const normalized = normalizeModule(makeNode24CommandStreamNamespace());

    expect(typeof normalized.$).toBe('function');
    expect(typeof normalized.sh).toBe('function');
    expect(typeof normalized.run).toBe('function');
  });

  test('keeps default pointing at the callable CommonJS export', () => {
    const namespace = makeNode24CommandStreamNamespace();
    const normalized = normalizeModule(namespace);

    expect(normalized.default).toBe(namespace.default);
    expect(normalized.default()).toBe('ran');
  });

  test('leaves an already-unwrapped namespace untouched', () => {
    const namespace = makeNode20CommandStreamNamespace();

    expect(normalizeModule(namespace)).toBe(namespace);
  });

  test('leaves a real ES module namespace untouched', () => {
    // lino-arguments is ESM-only, so its named exports are already top level.
    const namespace = { makeConfig: () => ({}), getenv: () => '' };

    expect(normalizeModule(namespace)).toBe(namespace);
  });

  test('does not unwrap a non-callable, non-object CommonJS default', () => {
    const namespace = { default: 'a string', 'module.exports': 'a string' };

    expect(normalizeModule(namespace)).toBe(namespace);
  });

  test('passes null and undefined through', () => {
    expect(normalizeModule(null)).toBe(null);
    expect(normalizeModule(undefined)).toBe(undefined);
  });

  test('unwraps a plain-object CommonJS default', () => {
    const exported = { alpha: 1, beta: () => 2 };
    const normalized = normalizeModule({
      default: exported,
      'module.exports': exported,
    });

    expect(normalized.alpha).toBe(1);
    expect(normalized.beta()).toBe(2);
    expect(normalized.default).toBe(exported);
  });
});

describe('CI command failure propagation (#340)', () => {
  test('rejects dependencies outside the reviewed installed package list', async () => {
    await expect(useModule('unreviewed-package')).rejects.toThrow(
      'Unsupported release dependency'
    );
  });
  test('requires a strict shell instead of silently accepting incompatible versions', () => {
    expect(() => configureModule('command-stream', { $: () => {} })).toThrow(
      'shell.errexit'
    );
    const other = { makeConfig: () => ({}) };
    expect(configureModule('lino-arguments', other)).toBe(other);
  });

  test('a real failed command rejects with its exit code and stderr', () => {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL(
            '../../experiments/issue-340/command-failure.mjs',
            import.meta.url
          )
        ),
        'after',
      ],
      { encoding: 'utf8' }
    );
    expect(result.status).toBe(7);
    expect(JSON.parse(result.stdout)).toEqual({
      rejected: true,
      code: 7,
      stderr: 'fetch first\n',
    });
  }, 30000);

  test('the real strict command runner reaches push retry on a nonzero exit', () => {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL(
            '../../experiments/issue-340/command-failure.mjs',
            import.meta.url
          )
        ),
        'retry',
      ],
      { encoding: 'utf8' }
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ pushes: 2, rebases: 1 });
  }, 30000);
});
