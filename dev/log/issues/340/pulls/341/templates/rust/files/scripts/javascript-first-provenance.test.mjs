// Default-branch cache contexts may execute only the event commit or reviewed
// default-branch history; PR runs have their own cache scope.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const runner = new URL('./verify-javascript-provenance.mjs', import.meta.url).pathname;
function fixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'javascript-provenance-'));
  const git = args => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', timeout: 20000,
      env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e' } });
    assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
  };
  try {
    git(['init', '-q', '-b', 'main']);
    writeFileSync(join(dir, 'source'), 'reviewed'); git(['add', '.']); git(['commit', '-qm', 'reviewed']);
    const published = git(['rev-parse', 'HEAD']);
    writeFileSync(join(dir, 'source'), 'release candidate'); git(['commit', '-qam', 'candidate']);
    const candidate = git(['rev-parse', 'HEAD']);
    git(['update-ref', 'refs/remotes/origin/main', candidate]);
    git(['switch', '-qc', 'untrusted', published]);
    writeFileSync(join(dir, 'source'), 'unreviewed'); git(['commit', '-qam', 'untrusted']);
    const untrusted = git(['rev-parse', 'HEAD']);
    const env = { ...process.env, EXPECTED_SHA: published, EVENT_SHA: published,
      PREREQUISITE_EVENT: 'workflow_dispatch', DEFAULT_BRANCH: 'main', GITHUB_OUTPUT: join(dir, '.git', 'output') };
    fn({ env, published, candidate, untrusted, run: () => spawnSync(process.execPath, [runner], { cwd: dir, env, encoding: 'utf8', timeout: 20000 }) });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
for (const event of ['workflow_dispatch', 'schedule', 'workflow_run', 'push']) {
  test(`${event}: arbitrary branch commits cannot execute in a default-branch cache context`, () => fixture(({ env, untrusted, run }) => {
    env.PREREQUISITE_EVENT = event; env.EXPECTED_SHA = untrusted;
    const result = run(); assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.equal(existsSync(env.GITHUB_OUTPUT), false);
  }));
}
test('the exact trusted event revision is permitted', () => fixture(({ env, published, run }) => {
  const result = run(); assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(env.GITHUB_OUTPUT, 'utf8'), `revision=${published}\n`);
}));
test('a committed release candidate reachable from the default branch is permitted', () => fixture(({ env, candidate, run }) => {
  env.EXPECTED_SHA = candidate;
  const result = run(); assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(env.GITHUB_OUTPUT, 'utf8'), `revision=${candidate}\n`);
}));
test('PR candidates may execute in the PR cache scope', () => fixture(({ env, untrusted, run }) => {
  env.PREREQUISITE_EVENT = 'pull_request'; env.EXPECTED_SHA = untrusted;
  const result = run(); assert.equal(result.status, 0, result.stdout + result.stderr);
}));
test('missing provenance cannot approve an alternative revision', () => fixture(({ env, candidate, run }) => {
  env.EXPECTED_SHA = candidate; env.DEFAULT_BRANCH = '';
  assert.notEqual(run().status, 0);
  assert.equal(existsSync(env.GITHUB_OUTPUT), false);
}));
