import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const runner = new URL('./run-javascript-first-auto.mjs', import.meta.url).pathname;
function fixture(mixed, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'javascript-auto-'));
  try {
    if (mixed) cpSync(new URL('../examples/javascript-first/', import.meta.url), dir, { recursive: true,
      filter: path => !path.includes('/target') });
    else writeFileSync(join(dir, 'Cargo.toml'), '[package]\n');
    const exec = (cmd, args) => spawnSync(cmd, args, { cwd: dir, encoding: 'utf8', timeout: 20000 });
    for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=t', '-c', 'user.email=t@e', 'commit', '-qm', 'fixture']]) {
      assert.equal(exec('git', args).status, 0);
    }
    const env = { ...process.env, EXPECTED_SHA: exec('git', ['rev-parse', 'HEAD']).stdout.trim(),
      JAVASCRIPT_COMMAND: '', PARITY_COMMAND: '', TRANSLATION_COMMAND: '', PROJECT_DIRECTORY: '.', GITHUB_OUTPUT: '' };
    fn(dir, env, () => spawnSync(process.execPath, [runner], { cwd: dir, env, encoding: 'utf8', timeout: 20000 }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('Rust-only checkout succeeds without supplying native commands', () => fixture(false, (dir, env, run) => {
  const result = run(); assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Rust-only/);
}));
test('Rust-only success records the exact revision for downstream checkouts', () => fixture(false, (dir, env, run) => {
  env.GITHUB_OUTPUT = join(dir, '.git', 'gate-output');
  const result = run(); assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(env.GITHUB_OUTPUT, 'utf8'), `sha=${env.EXPECTED_SHA}\njavascript-required=false\n`);
}));
test('auto-detected complete native counterpart passes the real three commands', () => fixture(true, (dir, env, run) => {
  const result = run(); assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Complete native readiness inventory/);
}));
for (const name of ['native-failure', 'native-skipped', 'missing-command', 'missing', 'partial', 'carried', 'unsupported', 'drift', 'wrong-sha']) {
  test(`auto-detected ${name} refuses a tested revision`, () => fixture(true, (dir, env, run) => {
    if (name === 'native-failure') env.JAVASCRIPT_COMMAND = 'exit 1';
    else if (name === 'native-skipped') env.JAVASCRIPT_COMMAND = 'exit 78';
    else if (name === 'wrong-sha') env.EXPECTED_SHA = 'a'.repeat(40);
    else if (name === 'missing-command') writeFileSync(join(dir, 'package.json'), '{}');
    else if (name === 'drift') writeFileSync(join(dir, 'src/lib.rs'), '// drift');
    else {
      const path = join(dir, 'parity.json'); const inventory = JSON.parse(readFileSync(path));
      if (name === 'missing') inventory.features.pop();
      else if (name === 'carried') inventory.features[0].carried = true;
      else inventory.features[0].status = name;
      writeFileSync(path, JSON.stringify(inventory));
    }
    env.GITHUB_OUTPUT = join(dir, '.git', 'gate-output');
    const result = run(); assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.equal(existsSync(env.GITHUB_OUTPUT), false, 'failed/skipped stages must not expose a tested SHA');
  }));
}
test('the Rust-only bypass still refuses an untested revision', () => fixture(false, (dir, env, run) => {
  env.EXPECTED_SHA = 'a'.repeat(40); assert.notEqual(run().status, 0);
}));
