import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe } from 'test-anywhere';
import { itUnless, sandboxed } from './helpers/skip.js';
import {
  assertValidatedRelease,
  prepareReleasePublication,
} from '../scripts/release-publication.mjs';
import { runCommand } from '../scripts/run-command.mjs';

describe('publication uses validated code', () => {
  itUnless(sandboxed)(
    'never pulls a newer source commit and recovers only version metadata',
    async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'release-publication-'));
      const git = (...args) => {
        const result = spawnSync('git', args, {
          cwd,
          encoding: 'utf8',
          timeout: 5000,
        });
        assert.equal(result.status, 0, result.stderr);
        return result.stdout.trim();
      };
      const runner = (command, args, options) =>
        runCommand(command, args, { ...options, cwd });
      const logger = { log() {} };
      const manifest = {
        name: 'fixture',
        version: '1.0.0',
        dependencies: { fixture: '1.0.0' },
      };
      const lock = {
        name: 'fixture',
        version: '1.0.0',
        lockfileVersion: 3,
        packages: { '': { ...manifest } },
      };
      const writeVersion = (version) => {
        manifest.version = version;
        lock.version = version;
        lock.packages[''].version = version;
        writeFileSync(
          join(cwd, 'package.json'),
          `${JSON.stringify(manifest)}\n`
        );
        writeFileSync(
          join(cwd, 'package-lock.json'),
          `${JSON.stringify(lock)}\n`
        );
      };
      try {
        git('init', '-q');
        git('config', 'user.email', 'test@example.com');
        git('config', 'user.name', 'Test');
        git('config', 'core.autocrlf', 'false');
        git('init', '--bare', '-q', 'origin.git');
        git('remote', 'add', 'origin', join(cwd, 'origin.git'));
        writeVersion('1.0.0');
        writeFileSync(join(cwd, 'source.js'), 'validated\n');
        git('add', 'package.json', 'package-lock.json', 'source.js');
        git('commit', '-qm', 'validated');
        const parentSha = git('rev-parse', 'HEAD');
        git('push', '-q', 'origin', 'HEAD:main');
        const options = { parentSha, runner, logger };

        writeFileSync(join(cwd, 'source.js'), 'unvalidated\n');
        git('commit', '-qam', 'new source');
        git('push', '-q', 'origin', 'HEAD:main');
        git('checkout', '-q', '--detach', parentSha);
        await prepareReleasePublication({ ...options, verifyRemote: true });
        assert.equal(git('rev-parse', 'HEAD'), parentSha);
        assert.equal(
          readFileSync(join(cwd, 'source.js'), 'utf8'),
          'validated\n'
        );
        await assert.rejects(
          assertValidatedRelease({ ...options, headRef: 'origin/main' }),
          /unvalidated release changes.*source.js/
        );

        writeVersion('1.0.1');
        git('add', 'package.json', 'package-lock.json');
        git('commit', '-qm', 'metadata recovery');
        const versionSha = git('rev-parse', 'HEAD');
        assert.equal(await assertValidatedRelease(options), versionSha);
        git('update-ref', 'refs/remotes/origin/main', versionSha);
        assert.equal(
          await assertValidatedRelease({ ...options, headRef: 'origin/main' }),
          versionSha
        );

        writeFileSync(join(cwd, 'source.js'), 'dirty source\n');
        await assert.rejects(prepareReleasePublication(options), /git diff/);
        git('restore', 'source.js');
        lock.packages['node_modules/fixture'] = { version: '2.0.0' };
        writeVersion('1.0.1');
        git('add', 'package-lock.json');
        git('commit', '--amend', '--no-edit', '-q');
        await assert.rejects(
          assertValidatedRelease(options),
          /Package configuration changed after validation: package-lock.json/
        );
        delete lock.packages['node_modules/fixture'];
        manifest.dependencies.fixture = '2.0.0';
        writeVersion('1.0.1');
        git('add', 'package.json', 'package-lock.json');
        git('commit', '--amend', '--no-edit', '-q');
        await assert.rejects(
          assertValidatedRelease(options),
          /Package configuration changed after validation/
        );
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    }
  );
});
