import assert from 'node:assert/strict';
import { describe, expect } from 'test-anywhere';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertReleaseMetadataOnly,
  stageReleaseMetadata,
} from '../scripts/release-metadata.mjs';
import { runCommand } from '../scripts/run-command.mjs';
import { itUnless, sandboxed } from './helpers/skip.js';

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr);
  }
  return result.stdout.trim();
}

describe('release metadata attestation', () => {
  itUnless(sandboxed)(
    'checks a real version commit against its validated parent',
    async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'release-metadata-'));
      try {
        git(cwd, 'init', '-q');
        git(cwd, 'config', 'user.email', 'test@example.com');
        git(cwd, 'config', 'user.name', 'Test');
        git(cwd, 'config', 'core.autocrlf', 'false');
        mkdirSync(join(cwd, '.changeset'));
        writeFileSync(join(cwd, '.changeset', 'fix.md'), '# fix\n');
        writeFileSync(join(cwd, 'package.json'), '{}\n');
        writeFileSync(join(cwd, 'src.js'), 'export const value = 1;\n');
        git(cwd, 'add', '-A');
        git(cwd, 'commit', '-qm', 'validated');
        const parentSha = git(cwd, 'rev-parse', 'HEAD');

        git(cwd, 'rm', '-q', '.changeset/fix.md');
        writeFileSync(join(cwd, 'package.json'), '{"version":"1.0.1"}\n');
        writeFileSync(join(cwd, 'CHANGELOG.md'), '# Release\n');
        writeFileSync(join(cwd, 'unrelated.txt'), 'must remain untracked\n');
        const stagingRunner = (command, args, options) =>
          runCommand(command, args, { ...options, cwd });
        writeFileSync(join(cwd, 'src.js'), 'unexpected tracked edit\n');
        await assert.rejects(
          stageReleaseMetadata({ runner: stagingRunner, logger: { log() {} } }),
          /M src.js/
        );
        git(cwd, 'restore', 'src.js');
        await stageReleaseMetadata({
          runner: stagingRunner,
          logger: { log() {} },
        });
        assert.deepEqual(
          git(cwd, 'diff', '--cached', '--name-only').split('\n'),
          ['.changeset/fix.md', 'CHANGELOG.md', 'package.json']
        );
        assert.equal(git(cwd, 'ls-files', 'unrelated.txt'), '');
        git(cwd, 'commit', '-qm', '1.0.1');
        const headSha = git(cwd, 'rev-parse', 'HEAD');
        const runner = (command, args, options) =>
          runCommand(command, args, { ...options, cwd });

        expect(
          await assertReleaseMetadataOnly({
            runner,
            parentSha,
            logger: { log() {} },
          })
        ).toBe(headSha);

        let rejected;
        try {
          await assertReleaseMetadataOnly({
            runner,
            parentSha: headSha,
            logger: { log() {} },
          });
        } catch (error) {
          rejected = error;
        }
        expect(rejected?.message).toContain('differs from validated parent');

        writeFileSync(join(cwd, 'src.js'), 'export const value = 2;\n');
        git(cwd, 'add', 'src.js');
        git(cwd, 'commit', '-qm', 'unexpected source change');
        rejected = undefined;
        try {
          await assertReleaseMetadataOnly({
            runner,
            parentSha: headSha,
            logger: { log() {} },
          });
        } catch (error) {
          rejected = error;
        }
        expect(rejected?.message).toContain('M src.js');
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    }
  );
});
