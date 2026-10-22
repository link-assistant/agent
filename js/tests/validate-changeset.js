/**
 * Regression tests for scripts/validate-changeset.mjs (issue #337).
 *
 * The validator used to count every changeset in js/.changeset. While an
 * earlier pull request's changeset was still unreleased, a pull request with
 * no changeset passed, and one that added its own failed as "multiple
 * changesets". Only changesets the pull request adds may count.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'scripts',
  'validate-changeset.mjs'
);

const changeset = (description) =>
  `---\n'@link-assistant/agent': patch\n---\n\n${description}\n`;

const roots = [];

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

// A repository whose `origin/main` already holds an unreleased changeset, with
// a pull request branch checked out on top of it.
function repoWithUnreleasedChangeset() {
  const root = mkdtempSync(join(tmpdir(), 'validate-changeset-'));
  roots.push(root);
  mkdirSync(join(root, 'js', '.changeset'), { recursive: true });
  writeFileSync(join(root, 'js', '.changeset', 'README.md'), '# Changesets\n');
  writeFileSync(
    join(root, 'js', '.changeset', 'earlier-pr.md'),
    changeset('An earlier pull request')
  );
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '.');
  git(
    root,
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-q',
    '-m',
    'base'
  );
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(root, 'checkout', '-q', '-b', 'pull-request');
  return root;
}

function commitChangeset(root, name) {
  writeFileSync(
    join(root, 'js', '.changeset', name),
    changeset(`Change from ${name}`)
  );
  git(root, 'add', '.');
  git(
    root,
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-q',
    '-m',
    name
  );
}

function validate(root) {
  const env = { ...process.env, GITHUB_BASE_REF: 'main' };
  delete env.CHANGESET_BASE_REF;
  const result = spawnSync('node', [scriptPath], {
    cwd: root,
    encoding: 'utf8',
    env,
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('validate-changeset', () => {
  test('fails a pull request that adds no changeset, even if one is pending', () => {
    const root = repoWithUnreleasedChangeset();

    const result = validate(root);

    expect(result.status).toBe(1);
    expect(result.output).toContain('This pull request adds no changeset');
  });

  test('passes a pull request that adds one changeset next to a pending one', () => {
    const root = repoWithUnreleasedChangeset();
    commitChangeset(root, 'this-pr.md');

    const result = validate(root);

    expect(result.status).toBe(0);
    expect(result.output).toContain('Validating changeset:');
    expect(result.output).toContain('this-pr.md');
    expect(result.output).not.toContain('earlier-pr.md');
  });

  test('fails a pull request that adds two changesets', () => {
    const root = repoWithUnreleasedChangeset();
    commitChangeset(root, 'first.md');
    commitChangeset(root, 'second.md');

    const result = validate(root);

    expect(result.status).toBe(1);
    expect(result.output).toContain('This pull request adds 2 changesets');
  });
});
