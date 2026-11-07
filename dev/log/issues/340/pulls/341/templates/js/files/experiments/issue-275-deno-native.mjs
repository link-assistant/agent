// Reproduce native-adapter resolution in a clean Deno checkout, then run every
// acceptance test with explicit locked fixture dependencies and a warm graph.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const source = resolve('.');
const parent = mkdtempSync(join(tmpdir(), 'issue-275-deno-native-'));
const checkout = join(parent, 'checkout');
const env = { ...process.env, NODE_OPTIONS: '--max-old-space-size=256' };
let added = false;

function run(command, args, cwd = checkout, capture = false) {
  console.log(`$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}

try {
  assert.equal(
    run('git', ['worktree', 'add', '--detach', checkout, 'HEAD'], source)
      .status,
    0
  );
  added = true;
  // Include improved assertion diagnostics before committing the CI fix.
  copyFileSync(
    join(source, 'tests/pipeline-requirements.test.js'),
    join(checkout, 'tests/pipeline-requirements.test.js')
  );
  const before = run(
    'deno',
    ['test', '-A', 'tests/pipeline-requirements.test.js'],
    checkout,
    true
  );
  console.log(before.stdout + before.stderr);
  assert.notEqual(before.status, 0);
  assert.match(before.stdout + before.stderr, /Cannot find module 'punycode\//);

  for (const args of [
    ['ci', '--no-audit', '--no-fund'],
    [
      'ci',
      '--prefix',
      '.github/actions/artifact-transport',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ],
  ]) {
    assert.equal(run('npm', args).status, 0);
  }
  copyFileSync(join(source, 'deno.json'), join(checkout, 'deno.json'));
  for (const file of [
    'tests/ci-audit-regressions.test.js',
    '.github/workflows/release.yml',
  ]) {
    copyFileSync(join(source, file), join(checkout, file));
  }
  const prepared = run(
    'deno',
    ['test', '-A', '--parallel', '--no-run', '--frozen'],
    checkout,
    true
  );
  console.log(prepared.stdout + prepared.stderr);
  assert.equal(prepared.status, 0);
  assert.doesNotMatch(
    prepared.stdout + prepared.stderr,
    /Ignored build scripts/
  );
  assert.equal(
    run('bash', [
      'scripts/run-with-budget-warning.sh',
      '100',
      'Deno test suite',
      'deno',
      'test',
      '-A',
      '--parallel',
    ]).status,
    0
  );
  console.log(
    'Clean Deno checkout: reproduced failure; full prepared suite passed.'
  );
} finally {
  if (added) {
    assert.equal(
      run('git', ['worktree', 'remove', '--force', checkout], source).status,
      0
    );
  }
  // The worktree and all dependency trees removed here belong to this probe.
  rmSync(parent, { recursive: true, force: true });
}
