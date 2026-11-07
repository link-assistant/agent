import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  readdir,
  symlink,
} from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe } from 'test-anywhere';
import { itUnless, sandboxed } from './helpers/skip.js';
import {
  collectArtifactFiles,
  packagePages,
  gnuTar,
} from '../scripts/artifact-files.mjs';

describe('artifact filesystem evidence', () => {
  itUnless(sandboxed)(
    'preserves file symlinks used by packaged applications',
    async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'artifact-symlink-'));
      try {
        const target = join(cwd, 'binary');
        const alias = join(cwd, 'binary-alias');
        await writeFile(target, 'packaged application');
        await symlink(target, alias, 'file');
        assert.deepEqual(
          await collectArtifactFiles(
            { glob: () => [alias], getSearchPaths: () => [cwd] },
            cwd
          ),
          { files: [alias], root: cwd }
        );
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    }
  );
  itUnless(sandboxed)(
    'requires the report even when optional diagnostics exist',
    async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'artifact-report-'));
      try {
        const recovered = join(cwd, 'recovered.txt');
        const report = join(cwd, 'out.md');
        await writeFile(recovered, 'optional archive suggestions');
        const search = {
          glob: () => [recovered],
          getSearchPaths: () => [cwd],
        };
        await assert.rejects(() => collectArtifactFiles(search, cwd, report));
        await writeFile(report, '');
        await assert.rejects(
          () => collectArtifactFiles(search, cwd, report),
          /Required artifact file is empty/
        );
        await writeFile(report, '# Broken links\n');
        assert.deepEqual(
          await collectArtifactFiles(
            { ...search, glob: () => [report, recovered] },
            cwd,
            report
          ),
          { files: [report, recovered], root: cwd }
        );
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    }
  );
  itUnless(sandboxed)(
    'rejects real empty directories and keeps the Pages tar contract',
    async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'artifact-files-'));
      let archive;
      try {
        const search = {
          glob: () => [cwd],
          getSearchPaths: () => [cwd],
        };
        await assert.rejects(
          () => collectArtifactFiles(search, cwd),
          /missing or empty/
        );
        await writeFile(join(cwd, 'index.html'), '<p>Required evidence</p>');
        await mkdir(join(cwd, '.github'));
        await writeFile(join(cwd, '.github', 'private'), 'excluded');
        const file = join(cwd, 'index.html');
        assert.deepEqual(
          await collectArtifactFiles(
            { ...search, glob: () => [cwd, file] },
            cwd
          ),
          { files: [file], root: cwd }
        );
        archive = await packagePages(cwd);
        assert.deepEqual(await readdir(archive.root), ['artifact.tar']);
        const listing = execFileSync(
          gnuTar(),
          ['--force-local', '-tf', archive.files[0]],
          { encoding: 'utf8' }
        );
        assert.match(listing, /index.html/);
        assert.doesNotMatch(listing, /private|\.github/);
      } finally {
        if (archive) {
          await rm(archive.root, { recursive: true, force: true });
        }
        await rm(cwd, { recursive: true, force: true });
      }
    }
  );
});
