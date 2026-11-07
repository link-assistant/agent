#!/usr/bin/env node

// Replay the regression suite against an isolated pre-fix Git snapshot.
// Usage: node experiments/issue-212-regressions.mjs [ref] [log-path]
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const ref = process.argv[2] || '4c8644fb457b65933fcb19b033e60e7d0338f2ad';
const log = resolve(process.argv[3] || 'ci-logs/issue-212-baseline.log');
mkdirSync(dirname(log), { recursive: true });
const snapshot = mkdtempSync(join(tmpdir(), 'issue-212-baseline-'));
const tests = [
  'pr-guards',
  'release-preflight',
  'release-badge',
  'commit-message',
  'run-with-budget-warning',
  'check-release-needed',
  'workflows-lint',
  'security-workflow',
].map((name) => `tests/${name}.test.js`);
try {
  const archive = join(snapshot, 'snapshot.tar');
  execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, ref]);
  execFileSync('tar', ['-xf', archive, '-C', snapshot]);
  symlinkSync(resolve('node_modules'), join(snapshot, 'node_modules'), 'dir');
  for (const path of [...tests, 'tests/fixtures/preflight-stub']) {
    cpSync(path, join(snapshot, path), { recursive: true });
  }
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-timeout=30000', ...tests],
    { cwd: snapshot, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
  );
  writeFileSync(log, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.status, 1, 'The pre-fix regression run must fail');
  console.log(`Expected pre-fix failures preserved in ${log}`);
} finally {
  rmSync(snapshot, { recursive: true, force: true });
}
