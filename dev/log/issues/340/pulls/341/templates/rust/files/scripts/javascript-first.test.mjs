import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = new URL('../', import.meta.url);
const runner = new URL('./run-javascript-first.sh', import.meta.url).pathname;
function fixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'javascript-first-'));
  try {
    cpSync(new URL('examples/javascript-first/', root), dir, { recursive: true,
      filter: path => !path.includes('/target') });
    const exec = (cmd, args) => spawnSync(cmd, args, { cwd: dir, encoding: 'utf8', timeout: 20000 });
    for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=t', '-c', 'user.email=t@e', 'commit', '-qm', 'fixture']]) {
      assert.equal(exec('git', args).status, 0);
    }
    const sha = exec('git', ['rev-parse', 'HEAD']).stdout.trim();
    const env = { ...process.env, EXPECTED_SHA: sha, JAVASCRIPT_COMMAND: 'node --test native.test.mjs',
      PARITY_COMMAND: 'node check-parity.mjs', TRANSLATION_COMMAND: 'node generate.mjs --check', GITHUB_OUTPUT: '' };
    fn(dir, env, () => spawnSync('bash', [runner], { cwd: dir, env, encoding: 'utf8', timeout: 20000 }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('all stages pass at the exact clean revision', () => fixture((dir, env, run) => {
  const result = run(); assert.equal(result.status, 0, result.stdout + result.stderr);
}));
for (const name of ['native-failure', 'native-skipped', 'missing-command', 'missing', 'partial', 'carried', 'drift', 'stale-source', 'wrong-sha']) {
  test(`${name} blocks every downstream Rust operation`, () => fixture((dir, env, run) => {
    if (name === 'native-failure') env.JAVASCRIPT_COMMAND = 'exit 1';
    else if (name === 'native-skipped') env.JAVASCRIPT_COMMAND = 'exit 78';
    else if (name === 'missing-command') env.JAVASCRIPT_COMMAND = '';
    else if (name === 'wrong-sha') env.EXPECTED_SHA = 'a'.repeat(40);
    else if (name === 'drift') writeFileSync(join(dir, 'src/lib.rs'), '// drift');
    else if (name === 'stale-source') writeFileSync(join(dir, 'native.mjs'), readFileSync(join(dir, 'native.mjs')) + '\n');
    else {
      const path = join(dir, 'parity.json'); const inventory = JSON.parse(readFileSync(path));
      if (name === 'missing') inventory.features.pop();
      else if (name === 'partial') inventory.features[0].status = 'partial';
      else inventory.features[0].carried = true;
      writeFileSync(path, JSON.stringify(inventory));
    }
    const result = run();
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
  }));
}
test('every Rust operation in the mixed caller needs the gate and its tested revision', () => {
  const text = readFileSync(new URL('.github/workflows/javascript-first-example.yml', root), 'utf8');
  const blocks = text.split(/\n(?=  [\w-]+:\n)/);
  const rustJobs = blocks.filter(block => /cargo (test|build|package|publish)|docker\/build-push-action|rust-toolchain@/.test(block));
  assert.ok(rustJobs.length);
  for (const block of rustJobs) {
    assert.match(block, /needs: javascript-first/);
    assert.match(block, /if: needs.javascript-first.result == 'success'/);
    assert.match(block, /ref: \$\{\{ needs.javascript-first.outputs.tested-sha \}\}/);
  }
  const workflow = readFileSync(new URL('.github/workflows/javascript-first-gate.yml', root), 'utf8');
  assert.doesNotMatch(workflow, /cargo |rust-toolchain@/);
});
test('the mixed caller does not execute arbitrary dispatch inputs in the default branch cache scope', () => {
  const text = readFileSync(new URL('.github/workflows/javascript-first-example.yml', root), 'utf8');
  assert.doesNotMatch(text, /workflow_dispatch|candidate-sha/);
  assert.match(text, /source-sha: \$\{\{ github.sha \}\}/);
});
