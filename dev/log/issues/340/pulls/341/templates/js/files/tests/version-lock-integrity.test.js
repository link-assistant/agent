import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe } from 'test-anywhere';
import { runBounded, HANG_GUARD_MS } from './helpers/bounded-run.js';
import { itUnless, sandboxed } from './helpers/skip.js';

export function withoutVersions(lock) {
  const value = globalThis.structuredClone(lock);
  delete value.version;
  delete value.packages[''].version;
  return value;
}

describe('offline release lock integrity', () => {
  for (const script of ['changeset-version', 'instant-version-bump']) {
    for (const jsRoot of ['.', 'js']) {
      itUnless(sandboxed)(
        `${script} preserves the entire peer graph in ${jsRoot}`,
        async () => {
          const cwd = mkdtempSync(join(tmpdir(), 'version-lock-'));
          const root = join(cwd, jsRoot);
          const link = join(root, 'node_modules');
          mkdirSync(join(root, '.changeset'), { recursive: true });
          const pkg = {
            name: 'release-fixture',
            version: '1.2.3',
            private: true,
          };
          const lock = {
            name: pkg.name,
            version: pkg.version,
            lockfileVersion: 3,
            requires: true,
            packages: {
              '': { ...pkg },
              'node_modules/locked-peer': {
                version: '27.0.0-alpha.13',
                peer: true,
                integrity: 'preserved-fixture',
                optional: true,
              },
            },
          };
          writeFileSync(
            join(root, 'package.json'),
            `${JSON.stringify(pkg, null, 2)}\n`
          );
          writeFileSync(
            join(root, 'package-lock.json'),
            `${JSON.stringify(lock, null, 2)}\n`
          );
          writeFileSync(
            join(root, 'CHANGELOG.md'),
            '# Changelog\n\n## 1.2.3\n\nPrevious.\n'
          );
          writeFileSync(
            join(root, '.changeset/config.json'),
            JSON.stringify({
              changelog: false,
              commit: false,
              fixed: [],
              linked: [],
              access: 'restricted',
              baseBranch: 'main',
              updateInternalDependencies: 'patch',
              ignore: [],
              privatePackages: { version: true, tag: false },
            })
          );
          writeFileSync(
            join(root, '.changeset/bump.md'),
            '---\n"release-fixture": patch\n---\n\nOffline rehearsal.\n'
          );
          symlinkSync(resolve('node_modules'), link, 'junction');
          try {
            const result = await runBounded(
              'node',
              [
                resolve(`scripts/${script}.mjs`),
                '--js-root',
                jsRoot,
                ...(script === 'instant-version-bump'
                  ? ['--bump-type', 'patch']
                  : []),
              ],
              {
                cwd,
                timeout: HANG_GUARD_MS,
                env: {
                  ...process.env,
                  JS_ROOT: jsRoot,
                  npm_config_offline: 'true',
                  npm_config_ignore_scripts: 'true',
                  npm_config_audit: 'false',
                  npm_config_fund: 'false',
                },
              }
            );
            const after = JSON.parse(
              readFileSync(join(root, 'package-lock.json'), 'utf8')
            );
            assert.deepEqual(
              withoutVersions(after),
              withoutVersions(lock),
              result.stdout
            );
            assert.equal(after.version, '1.2.4');
            assert.equal(after.packages[''].version, '1.2.4');
            assert.equal(
              JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
                .version,
              '1.2.4'
            );
          } finally {
            unlinkSync(link);
            rmSync(cwd, { recursive: true, force: true });
          }
        }
      );
    }
  }
});
