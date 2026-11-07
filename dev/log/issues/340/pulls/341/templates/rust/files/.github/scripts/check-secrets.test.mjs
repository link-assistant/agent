import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, copyFileSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { MAX_ARCHIVE_BYTES } from './check-secrets.mjs';

const cli = new URL('./check-secrets.mjs', import.meta.url).pathname;
// Construct a nonfunctional test credential at runtime so the test source is clean.
const secret = 'aws_secret_access_key = ' + 'A'.repeat(40);
function fixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'tracked-secrets-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  try {
    git('init', '-q');
    writeFileSync(join(dir, '.gitignore'), '*.log\n*.gz\nexperiments/\n');
    copyFileSync(new URL('../../.secretlintrc.json', import.meta.url), join(dir, '.secretlintrc.json'));
    git('add', '.gitignore', '.secretlintrc.json');
    const run = () => spawnSync(process.execPath, [cli], { cwd: dir, encoding: 'utf8', timeout: 20000 });
    fn({ dir, git, run });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('tracked ignored logs, experiments and literal paths are scanned; untracked output is skipped',
  { timeout: 60000 }, () => fixture(({ dir, git, run }) => {
    writeFileSync(join(dir, 'untracked.log'), secret);
    assert.equal(run().status, 0);
    writeFileSync(join(dir, 'baseline.log'), secret);
    git('add', '-f', 'baseline.log');
    const oldCommand = spawnSync(process.execPath, [
      new URL('../secretlint/node_modules/secretlint/bin/secretlint.js', import.meta.url).pathname,
      '--secretlintignore', '.gitignore', '**/*',
    ], { cwd: dir, encoding: 'utf8', timeout: 20000 });
    assert.equal(oldCommand.status, 0, oldCommand.stderr);
    assert.equal(run().status, 1, 'the same tracked ignored credential must now fail');
    git('rm', '-f', 'baseline.log');
    for (const file of ['evidence.log', 'experiments/probe.txt', 'literal[1].log', '-option.log', 'space name.log', 'line\nbreak.log']) {
      mkdirSync(join(dir, 'experiments'), { recursive: true });
      writeFileSync(join(dir, file), secret);
      git('add', '-f', '--', file);
      const result = run();
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout, /AWS/);
      git('rm', '-f', '--', file);
    }
  }));

test('gzip evidence is inflated and scanned; corrupt and oversized data fail closed',
  { timeout: 60000 }, () => fixture(({ dir, git, run }) => {
    const file = join(dir, 'evidence.log.gz');
    git('add', '.gitignore');
    const member = gzipSync(Buffer.alloc(1024 * 1024, 32));
    const oversized = Buffer.concat(Array(MAX_ARCHIVE_BYTES / (1024 * 1024) + 1).fill(member));
    for (const [data, expected, diagnostic] of [[gzipSync('clean'), 0], [gzipSync(secret), 1],
      [Buffer.from('corrupt'), 1, /compressed evidence/], [oversized, 1, /compressed evidence/]]) {
      writeFileSync(file, data); git('add', '-f', 'evidence.log.gz');
      const result = run();
      assert.equal(result.status, expected, result.stdout + result.stderr);
      if (diagnostic) assert.match(result.stderr, diagnostic);
    }
    truncateSync(file, MAX_ARCHIVE_BYTES + 1);
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Archive too large/);
  }));

test('missing Git checkout and missing tracked files cannot report a clean scan', () => fixture(({ dir, git, run }) => {
  writeFileSync(join(dir, 'missing.log'), 'clean'); git('add', '-f', 'missing.log');
  rmSync(join(dir, 'missing.log'));
  assert.equal(run().status, 1);
  rmSync(join(dir, '.git'), { recursive: true });
  assert.equal(run().status, 1);
}));
