/* eslint local/no-changelog-comments: "off" */

/**
 * Guard that keeps every pipeline script on the installed-dependency shim.
 *
 * A raw `const { $ } = await use('command-stream')` yields `undefined` on Node
 * 22.12+ because of the synthetic `module.exports` CommonJS export, so the
 * script dies with `TypeError: $ is not a function` inside the release job.
 * Loading through scripts/use-module.mjs normalises that namespace.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'test-anywhere';

const scriptsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts'
);
const SHIM = 'use-module.mjs';
const BOOTSTRAP = 'bootstrap-dependencies.mjs';

function scriptSources() {
  return readdirSync(scriptsDir)
    .filter(
      (name) => name.endsWith('.mjs') && name !== SHIM && name !== BOOTSTRAP
    )
    .map((name) => ({
      name,
      source: readFileSync(join(scriptsDir, name), 'utf8'),
    }));
}

describe('pipeline scripts load installed dependencies through the interop shim', () => {
  it('never destructures a package straight off use()', () => {
    const offenders = scriptSources()
      .filter(({ source }) =>
        /const\s*\{[^}]*\}\s*=\s*await\s+use\(/.test(source)
      )
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });

  it('never fetches and evals use.js inline', () => {
    const offenders = scriptSources()
      .filter(({ source }) =>
        /eval\(\s*\n?\s*await\s*\(await\s*fetch\(/.test(source)
      )
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });

  it('never awaits a loader at module scope outside the bootstrap', () => {
    // A module-scope `await loadCommandStream()` that fails kills the script
    // during initialisation: no log line, no GITHUB_OUTPUT, only a loader
    // stack. bootstrapDependencies() turns that into a reported failure.
    const offenders = scriptSources()
      .filter(({ source }) =>
        /^const\s[^\n]*await\s+load(CommandStream|LinoArguments)\(/m.test(
          source
        )
      )
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });

  it('routes every command-stream consumer through the shim', () => {
    const offenders = scriptSources()
      .filter(({ source }) => source.includes('loadCommandStream'))
      .filter(({ source }) => !source.includes(`./${SHIM}`))
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });
});
