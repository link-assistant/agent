/** Rehearse the real pending Changesets without modifying the checkout. */
import { cpSync, mkdtempSync, symlinkSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  captureVersionTree,
  syncVersionLock,
} from '../scripts/version-lock.mjs';

const cwd = mkdtempSync(join(tmpdir(), 'offline-release-'));
const modules = join(cwd, 'node_modules');
try {
  for (const name of [
    'package.json',
    'package-lock.json',
    'CHANGELOG.md',
    '.changeset',
  ]) {
    cpSync(resolve(name), join(cwd, name), { recursive: true });
  }
  symlinkSync(resolve('node_modules'), modules, 'junction');
  const before = captureVersionTree(cwd);
  execFileSync('node', [resolve('scripts/changeset-version.mjs')], {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      JS_ROOT: '.',
      npm_config_offline: 'true',
      npm_config_ignore_scripts: 'true',
    },
  });
  syncVersionLock(cwd, before);
  console.log(
    'Offline rehearsal preserved every non-version package/lock field.'
  );
} finally {
  unlinkSync(modules);
  rmSync(cwd, { recursive: true, force: true });
}
