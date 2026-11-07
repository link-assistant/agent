// Run the PR versioning step in an isolated worktree without Deno or publishing.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const temporary = mkdtempSync(join(tmpdir(), 'release-dry-run-'));
const cwd = join(temporary, 'checkout');
try {
  execFileSync('git', ['worktree', 'add', '--detach', cwd, 'HEAD']);
  symlinkSync(resolve('node_modules'), join(cwd, 'node_modules'), 'junction');
  const env = { ...process.env };
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH');
  assert.ok(pathKey, 'Node and npm must be on PATH');
  env[pathKey] = env[pathKey]
    .split(delimiter)
    .filter(
      (dir) =>
        !['deno', 'deno.exe', 'deno.cmd'].some((name) =>
          existsSync(join(dir, name))
        )
    )
    .join(delimiter);
  assert.equal(spawnSync('deno', ['--version'], { env }).error?.code, 'ENOENT');
  const result = spawnSync(
    'bash',
    [
      '-e',
      '-c',
      "trap 'git restore --source=HEAD --staged --worktree -- .' EXIT\nnpm run changeset:version\ngit status --short",
    ],
    { cwd, env, stdio: 'inherit' }
  );
  assert.equal(result.status, 0, String(result.error || 'Versioning failed'));
  // Git's directory-only ignore pattern does not cover our dependency symlink.
  unlinkSync(join(cwd, 'node_modules'));
  assert.equal(
    execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }),
    '',
    'The EXIT trap must restore release metadata and consumed changesets'
  );
  console.log('Real PR release versioning passed and restored the checkout.');
} finally {
  if (existsSync(cwd)) {
    execFileSync('git', ['worktree', 'remove', '--force', cwd]);
  }
  rmSync(temporary, { recursive: true, force: true });
}
