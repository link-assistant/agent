// Finite regression probes: original source-size/changeset guards versus fix.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { URL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixture = mkdtempSync(path.join(tmpdir(), 'agent-ci-340-'));
const git = (...args) =>
  execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args],
    { cwd: fixture, encoding: 'utf8' }
  ).trim();
const run = (file, env = {}) =>
  spawnSync(process.execPath, [file], {
    cwd: fixture,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
try {
  git('init', '-q', '-b', 'main');
  mkdirSync(path.join(fixture, 'js/.changeset'), { recursive: true });
  writeFileSync(path.join(fixture, 'README.md'), '# Before\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  writeFileSync(path.join(fixture, 'README.md'), '# After\n');
  git('add', '.');
  git('commit', '-qm', 'documentation');
  const original = (name) => {
    const target = path.join(fixture, `original-${name}`);
    writeFileSync(
      target,
      execFileSync('git', ['show', `1b48e9c:scripts/${name}`], { cwd: root })
    );
    return target;
  };
  const env = { GITHUB_BASE_REF: 'main', CHANGESET_BASE_REF: 'main' };
  const docsBefore = run(original('validate-changeset.mjs'), env);
  const docsAfter = run(path.join(root, 'scripts/validate-changeset.mjs'), env);
  assert.equal(docsBefore.status, 1);
  assert.equal(docsAfter.status, 0);
  console.log('Docs-only PR: baseline wrongly rejects (1); fixed accepts (0).');

  writeFileSync(
    path.join(fixture, 'oversized.ts'),
    '// bounded fixture\n'.repeat(1501)
  );
  git('add', 'oversized.ts');
  const sizeBefore = run(original('check-file-size.mjs'));
  const sizeAfter = run(path.join(root, 'scripts/check-file-size.mjs'));
  assert.equal(sizeBefore.status, 0);
  assert.equal(sizeAfter.status, 1);
  assert.match(sizeAfter.stderr, /oversized.ts/);
  console.log(
    '1501-line TypeScript: baseline misses violation (0); fixed rejects (1).'
  );
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
