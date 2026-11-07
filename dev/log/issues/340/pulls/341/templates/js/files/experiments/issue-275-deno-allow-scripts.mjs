// Show that Deno ignores npm's allowScripts and needs its own decision in
// deno.json: install node-pty@1.1.0 with and without the Deno denial and
// compare the "Ignored build scripts" warning. Usage:
//   node experiments/issue-275-deno-allow-scripts.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function install(denoConfig) {
  const root = mkdtempSync(join(tmpdir(), 'issue-275-deno-scripts-'));
  try {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        private: true,
        dependencies: { 'node-pty': '1.1.0' },
        allowScripts: { 'node-pty': false },
      })
    );
    writeFileSync(join(root, 'deno.json'), JSON.stringify(denoConfig));
    const result = spawnSync('deno', ['install'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout + result.stderr;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const npmPolicyOnly = install({ nodeModulesDir: 'auto' });
assert.match(npmPolicyOnly, /node-pty/);
assert.match(npmPolicyOnly, /Ignored build scripts|allow-scripts/i);
const denoPolicy = install({
  nodeModulesDir: 'auto',
  allowScripts: { deny: ['npm:node-pty@1.1.0'] },
});
assert.doesNotMatch(denoPolicy, /Ignored build scripts|allow-scripts/i);
console.log('Deno warns without its own policy; deno.json denial is silent.');
