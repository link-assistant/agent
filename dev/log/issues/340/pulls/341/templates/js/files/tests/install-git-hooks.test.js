import assert from 'node:assert/strict';
import { blankEnv } from './helpers/env.js';
import { describe, it, expect } from 'test-anywhere';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { itUnless, sandboxed } from './helpers/skip.js';
import * as hooks from '../scripts/install-git-hooks.mjs';

const scriptPath = path.resolve('scripts/install-git-hooks.mjs');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

describe('install-git-hooks.mjs', () => {
  it('replaces the unconditionally-masked prepare script', () => {
    expect(packageJson.scripts.prepare).toBe(
      'node scripts/install-git-hooks.mjs'
    );
    expect(packageJson.scripts.prepare).not.toContain('|| true');
    expect(packageJson.devDependencies.husky).toBeTruthy();
    assert.doesNotMatch(
      readFileSync(scriptPath, 'utf8'),
      /execFileSync\('npx'/
    );
  });

  for (const [name, env, git] of [
    ['on CI', { CI: '1' }, true],
    ['with HUSKY=0', { HUSKY: '0' }, true],
    ['outside a git repository', {}, false],
  ]) {
    it(`skips ${name} without invoking husky`, async () => {
      let called = false;
      const status = await hooks.installGitHooks({
        env,
        exists: () => git,
        install: () => {
          called = true;
          return '';
        },
      });
      assert.equal(status, 0);
      assert.equal(called, false);
    });
  }

  it('runs husky and passes when core.hooksPath is set', async () => {
    let called = false;
    const status = await hooks.installGitHooks({
      env: {},
      exists: () => true,
      install: () => {
        called = true;
        return '';
      },
      readHooksPath: () => '.husky/_',
    });
    assert.equal(status, 0);
    assert.equal(called, true);
  });

  for (const message of [".git can't be found", '']) {
    it(`fails when hooks are unset and husky reports ${message || 'nothing'}`, async () => {
      const errors = [];
      const status = await hooks.installGitHooks({
        env: {},
        exists: () => true,
        install: () => message,
        readHooksPath: () => {
          throw new Error('unset');
        },
        log: (error) => errors.push(error),
      });
      assert.equal(status, 1);
      assert.match(errors[0], /git hooks were not installed/);
      assert.ok(errors[0].includes(message || 'husky said nothing'));
    });
  }

  itUnless(sandboxed)(
    'installs husky hooks into a real repository on every OS',
    () => {
      const root = mkdtempSync(path.join(tmpdir(), 'git-hooks-repo-'));
      const env = blankEnv(process.env, (name) =>
        [
          'CI',
          'HUSKY',
          'GIT_DIR',
          'GIT_WORK_TREE',
          'GIT_CONFIG_COUNT',
        ].includes(name)
      );
      try {
        execFileSync('git', ['init', '-q'], { cwd: root, env });
        const result = spawnSync('node', [scriptPath], {
          cwd: root,
          env,
          encoding: 'utf8',
        });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(
          execFileSync(
            'git',
            ['config', '--local', '--get', 'core.hooksPath'],
            { cwd: root, env, encoding: 'utf8' }
          ).trim(),
          '.husky/_'
        );
        assert.ok(existsSync(path.join(root, '.husky/_/pre-commit')));
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );
});
