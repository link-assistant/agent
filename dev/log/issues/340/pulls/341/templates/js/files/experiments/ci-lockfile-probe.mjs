// Reproduce the foreign-lock warning created by a Bun CI dependency install.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'bun-ci-lock-'));
try {
  for (const file of [
    'package.json',
    'package-lock.json',
    'deno.json',
    'deno.lock',
  ]) {
    copyFileSync(file, join(root, file));
  }
  const install = spawnSync(
    'bun',
    ['install', '--lockfile-only', '--ignore-scripts'],
    { cwd: root, encoding: 'utf8', timeout: 20000 }
  );
  if (install.status !== 0) {
    throw new Error(
      `${install.error || ''}\n${install.stdout}\n${install.stderr}`
    );
  }
  const guard = spawnSync(
    'node',
    [resolve('scripts/check-package-manager.mjs')],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 5000,
    }
  );
  console.log(guard.stdout);
  console.log(guard.stderr);
  if (guard.status !== 0 || !guard.stderr.includes('bun.lock')) {
    throw new Error(
      'The generated foreign Bun lock should warn without failing.'
    );
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
