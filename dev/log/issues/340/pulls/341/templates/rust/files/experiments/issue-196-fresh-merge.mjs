// Real local Git merges: a newly introduced native port must gate Cargo work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const script = new URL('../scripts/simulate-fresh-merge.sh', import.meta.url).pathname;
for (const mixed of [false, true]) {
  test(`fresh merge ${mixed ? 'introducing a native counterpart blocks unchecked Rust' : 'of Rust-only source permits Rust checks'}`, () => {
    const dir = mkdtempSync(join(tmpdir(), '196-fresh-merge-'));
    const origin = join(dir, 'origin'); const clone = join(dir, 'clone');
    mkdirSync(origin);
    const git = (cwd, args) => {
      const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 20000,
        env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e' } });
      assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
    };
    try {
      git(origin, ['init', '-q', '-b', 'main']);
      writeFileSync(join(origin, 'Cargo.toml'), '[package]\n');
      git(origin, ['add', '.']); git(origin, ['commit', '-qm', 'base']);
      git(dir, ['clone', '-q', origin, clone]);
      git(clone, ['switch', '-qc', 'feature']);
      writeFileSync(join(clone, mixed ? 'native.mjs' : 'feature.rs'), '// new source\n');
      git(clone, ['add', '.']); git(clone, ['commit', '-qm', 'feature']);
      const head = git(clone, ['rev-parse', 'HEAD']);
      const result = spawnSync('bash', [script], { cwd: clone, encoding: 'utf8', timeout: 20000,
        env: { ...process.env, GITHUB_BASE_REF: 'main', FRESH_MERGE_CHECKS: 'touch .git/rust-check-ran',
          JAVASCRIPT_COMMAND: '', PARITY_COMMAND: '', TRANSLATION_COMMAND: '', PROJECT_DIRECTORY: '.', GITHUB_OUTPUT: '' } });
      assert.equal(result.status === 0, !mixed, result.stdout + result.stderr);
      assert.equal(existsSync(join(clone, '.git/rust-check-ran')), !mixed);
      assert.equal(git(clone, ['rev-parse', 'HEAD']), head, 'restore original revision');
      assert.equal(git(clone, ['branch', '--show-current']), 'feature', 'restore original branch');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
