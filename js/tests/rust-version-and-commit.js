/**
 * Regression test for scripts/rust-version-and-commit.mjs (issue #337).
 *
 * When another job pushed to main first, the script retried its push after
 * `git pull --rebase`, but it had already created the release tag on the
 * pre-rebase commit. The tag then pointed at a commit that never reached main.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'scripts',
  'rust-version-and-commit.mjs'
);

const roots = [];

function git(cwd, ...args) {
  const result = spawnSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args],
    { cwd, encoding: 'utf8' }
  );
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

// A bare `origin`, a release checkout cloned from it, and a second clone that
// the release checkout's pre-push hook uses to land a concurrent commit on
// main exactly once, so the first `git push` of the release is rejected.
function releaseCheckoutRacingAnotherPush() {
  const root = mkdtempSync(join(tmpdir(), 'rust-version-and-commit-'));
  roots.push(root);
  const origin = join(root, 'origin.git');
  const seed = join(root, 'seed');
  const other = join(root, 'other');
  const release = join(root, 'release');
  const bin = join(root, 'bin');

  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  mkdirSync(join(seed, 'rust', 'changelog.d'), { recursive: true });
  writeFileSync(
    join(seed, 'rust', 'Cargo.toml'),
    '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n'
  );
  writeFileSync(join(seed, 'rust', 'Cargo.lock'), '# lock\n');
  writeFileSync(
    join(seed, 'rust', 'changelog.d', '20260101_000000_fix.md'),
    '### Fixed\n\n- A fix\n'
  );
  git(root, 'init', '-q', '-b', 'main', seed);
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'base');
  git(seed, 'remote', 'add', 'origin', origin);
  git(seed, 'push', '-q', 'origin', 'main');

  git(root, 'clone', '-q', origin, other);
  git(root, 'clone', '-q', origin, release);

  const marker = join(root, 'raced');
  writeFileSync(
    join(release, '.git', 'hooks', 'pre-push'),
    [
      '#!/bin/sh',
      `[ -e '${marker}' ] && exit 0`,
      `touch '${marker}'`,
      'unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE',
      `cd '${other}' || exit 1`,
      'echo concurrent > concurrent.txt',
      'git add concurrent.txt',
      'git -c user.name=other -c user.email=other@example.com commit -q -m concurrent',
      'git push -q origin main',
      '',
    ].join('\n')
  );
  chmodSync(join(release, '.git', 'hooks', 'pre-push'), 0o755);

  // The script regenerates Cargo.lock; the lockfile content is irrelevant here.
  mkdirSync(bin);
  writeFileSync(join(bin, 'cargo'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(bin, 'cargo'), 0o755);

  return { origin, release, bin };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('rust-version-and-commit', () => {
  // The hook and the cargo stub are POSIX shell scripts.
  test.skipIf(process.platform === 'win32')(
    'tags the commit that reached main when the first push loses a race',
    () => {
      const { origin, release, bin } = releaseCheckoutRacingAnotherPush();
      const env = {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH}`,
      };
      delete env.GITHUB_OUTPUT;

      const result = spawnSync(
        'node',
        [scriptPath, '--bump-type', 'patch', '--rust-root', 'rust'],
        { cwd: release, encoding: 'utf8', env }
      );

      expect(`${result.stdout}${result.stderr}`).toContain(
        'Push failed (attempt 1/3)'
      );
      expect(result.status).toBe(0);
      const tagged = git(origin, 'rev-parse', 'rust-v0.1.1^{commit}');
      const main = git(origin, 'rev-parse', 'main');
      expect(tagged).toBe(main);
    },
    30000
  );
});
