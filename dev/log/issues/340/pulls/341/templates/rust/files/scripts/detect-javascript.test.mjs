import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const detector = new URL('./detect-javascript.mjs', import.meta.url).pathname;
function fixture(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'detect-javascript-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(join(dir, name, '..'), { recursive: true });
      writeFileSync(join(dir, name), content);
    }
    for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=t', '-c', 'user.email=t@e', 'commit', '-qm', 'fixture']]) {
      assert.equal(spawnSync('git', args, { cwd: dir }).status, 0);
    }
    const run = (args = []) => spawnSync(process.execPath, [detector, ...args], { cwd: dir, encoding: 'utf8', timeout: 20000 });
    fn(run, dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('Rust-only repositories pass without a JavaScript port or commands', () => fixture({ 'Cargo.toml': '[package]\n', 'src/lib.rs': '// rust' }, run => {
  const result = run(); assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).required, false);
}));
test('tooling, examples, docs, tests, generated dependencies and configuration do not imply a port', () => fixture({
  'Cargo.toml': '', 'scripts/check.mjs': '', 'examples/demo/native.mjs': '', 'tests/native.test.mjs': '',
  'docs/site/app.js': '', 'node_modules/dependency/index.js': '', 'target/debug/generated.js': '',
  'frontend/src/main.js': '', 'web/app.js': '', 'public/app.js': '', 'assets/app.js': '',
  'eslint.config.js': '', 'package.json': '{"scripts":{"lint":"eslint ."}}',
}, run => {
  const result = run(); assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).required, false);
}));
for (const path of ['src/native.mjs', 'javascript/native.js', 'packages/native/src/index.ts', 'index.cjs']) {
  test(`production source ${path} automatically requires the strict gate`, () => fixture({ 'Cargo.toml': '', [path]: '' }, run => {
    const result = run(); assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).required, true);
  }));
}
test('explicit project selection includes an otherwise excluded example', () => fixture({
  'Cargo.toml': '', 'examples/mixed/Cargo.toml': '', 'examples/mixed/native.mjs': '',
}, run => {
  const result = run(['examples/mixed']); assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).required, true);
}));
test('untracked source is not silently adopted as tested evidence', () => fixture({ 'Cargo.toml': '' }, (run, dir) => {
  writeFileSync(join(dir, 'native.mjs'), '');
  assert.equal(JSON.parse(run().stdout).required, false);
}));
test('project directories cannot escape the checkout', () => fixture({ 'Cargo.toml': '' }, run => {
  assert.notEqual(run(['..']).status, 0);
}));
test('configured ports remain gated when all production source has been removed', () => fixture({
  'Cargo.toml': '', 'package.json': '{"scripts":{"javascript-first:parity":"exit 1"}}',
}, run => {
  const result = run(); assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).required, true);
}));
