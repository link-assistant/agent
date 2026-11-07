// Repository-wide acceptance assertions: no Rust path can bypass the prerequisite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = name => readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
function jobs(text) { return [...text.matchAll(/^  ([\w-]+):\n([\s\S]*?)(?=^  [\w-]+:\n|(?![\s\S]))/gm)]; }
for (const workflow of ['release', 'desktop-release', 'security', 'workflows', 'javascript-first-example']) {
  test(`${workflow}: every Rust/toolchain/container job consumes a successful exact-revision gate`, () => {
    const text = read(workflow);
    for (const [, name, block] of jobs(text)) {
      if (!/rust-toolchain@|cargo (?:test|build|package|publish|doc|audit)|rustc |docker\/build-push-action@/.test(block)) continue;
      assert.match(block, /needs:[^\n]*javascript-first/, `${workflow}/${name} missing dependency`);
      const gate = name === 'docker-publish' ? 'release-javascript-first' : 'javascript-first';
      assert.ok(block.includes(`needs.${gate}.result == 'success'`), `${workflow}/${name} permits failed/skipped gate`);
      const direct = block.includes(`ref: \${{ needs.${gate}.outputs.tested-sha }}`);
      const eventPinned = block.includes(`ref: \${{ needs.${gate}.outputs.tested-sha == github.sha && github.sha }}`) &&
        block.includes(`needs.${gate}.result == 'success' && needs.${gate}.outputs.tested-sha == github.sha`);
      const verifiedTag = (workflow === 'desktop-release' || name === 'docker-publish') &&
        block.includes(`TESTED_SHA: \${{ needs.${gate}.outputs.tested-sha }}`) &&
        block.includes('test "$(git rev-parse HEAD)" = "$TESTED_SHA"') &&
        block.indexOf('name: Verify prerequisite revision') < block.search(/rust-toolchain@|docker\/login-action@/);
      assert.ok(direct || eventPinned || verifiedTag, `${workflow}/${name} does not enforce the tested SHA`);
    }
    assert.match(text, /- javascript-first\n/, 'terminal observer must collect gate failures');
  });
}
test('release writers validate the generated candidate before any product build or publish', () => {
  for (const [, name, block] of jobs(read('release'))) {
    if (!['auto-release', 'manual-release'].includes(name)) continue;
    const version = block.indexOf('rust-script scripts/version-and-commit.rs');
    const candidate = block.indexOf('node scripts/run-javascript-first-auto.mjs');
    assert.ok(version >= 0 && candidate > version, name);
    assert.ok(candidate < block.indexOf('run: cargo build --release'), name);
    assert.match(block, /tested-sha: \$\{\{ steps.candidate.outputs.sha \}\}/);
  }
});
test('writers cannot be cancelled by superseded read-only checks', () => {
  for (const workflow of ['release', 'desktop-release']) {
    const text = read(workflow);
    assert.doesNotMatch(text.split('jobs:')[0], /^concurrency:/m);
    for (const [, name, block] of jobs(text)) {
      if (!/group: main-writer-/.test(block)) continue;
      assert.match(block, /cancel-in-progress: false/, name);
      assert.match(block, /queue: max/, name);
    }
  }
});

test('simulated merges validate the new revision before running any Cargo checks', () => {
  const text = readFileSync(new URL('../scripts/simulate-fresh-merge.sh', import.meta.url), 'utf8');
  const gate = text.indexOf('node "$PREREQUISITE_RUNNER"');
  assert.match(text, /PREREQUISITE_RUNNER=.*run-javascript-first-auto.mjs/);
  assert.ok(gate > text.indexOf('git merge --no-edit'));
  assert.ok(gate < text.indexOf("DEFAULT_CHECKS='cargo fmt"));
});
test('release writers attach a branch without moving away from the tested revision', () => {
  for (const [, name, block] of jobs(read('release'))) {
    if (!['auto-release', 'manual-release'].includes(name)) continue;
    assert.match(block, /git switch -C "\$RELEASE_BRANCH" "\$TESTED_SHA"/);
    assert.match(block, /git branch --set-upstream-to=/);
  }
});
test('older release tags use prerequisite tools preserved from the workflow revision', () => {
  const text = read('javascript-first-gate');
  assert.ok(text.indexOf('ref: ${{ github.workflow_sha }}') < text.indexOf('ref: ${{ steps.provenance.outputs.revision }}'));
  assert.match(text, /cp scripts\/detect-javascript.mjs scripts\/run-javascript-first-auto.mjs/);
  assert.match(text, /node "\$RUNNER_TEMP\/javascript-first-tools\/run-javascript-first-auto.mjs"/);
});
test('candidate provenance is checked before checkout or execution in the reusable gate', () => {
  const text = read('javascript-first-gate');
  assert.match(text, /fetch-depth: 0/);
  assert.match(text, /PREREQUISITE_EVENT: \$\{\{ github.event_name \}\}/);
  assert.match(text, /DEFAULT_BRANCH: \$\{\{ github.event.repository.default_branch \}\}/);
  assert.ok(text.indexOf('id: provenance') < text.indexOf('ref: ${{ steps.provenance.outputs.revision }}'));
  assert.ok(text.indexOf('verify-javascript-provenance.mjs"') < text.indexOf('ref: ${{ steps.provenance.outputs.revision }}'));
});
