import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Issue #335: in a git worktree (or submodule) `.git` is a file. Project
 * detection wrote its id cache to `.git/opencode` without handling the ENOTDIR
 * rejection, so the CLI exited with an UnhandledRejection on every run there.
 */
const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'project-from-directory.ts'
);

let root = '';
let rootCommit = '';

function git(cwd: string, ...args: string[]) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.test',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.test',
    },
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

// The worktree is what git reports (on Windows `C:/Users/...` with forward
// slashes and long names, unlike `os.tmpdir()`), so compare against git.
function toplevel(directory: string) {
  return git(
    directory,
    'rev-parse',
    '--path-format=absolute',
    '--show-toplevel'
  );
}

function detect(directory: string) {
  const result = spawnSync(process.execPath, [fixture, directory], {
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      ...process.env,
      XDG_CACHE_HOME: path.join(root, 'xdg', 'cache'),
      XDG_CONFIG_HOME: path.join(root, 'xdg', 'config'),
      XDG_DATA_HOME: path.join(root, 'xdg', 'data'),
      XDG_STATE_HOME: path.join(root, 'xdg', 'state'),
    },
  });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    project: result.status === 0 ? JSON.parse(result.stdout.trim()) : undefined,
  };
}

beforeAll(() => {
  root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'agent-project-worktree-'))
  );
  const main = path.join(root, 'main');
  fs.mkdirSync(main);
  git(main, 'init', '-q');
  git(main, 'commit', '-q', '--allow-empty', '-m', 'init');
  rootCommit = git(main, 'rev-list', '--max-parents=0', 'HEAD');
  git(main, 'worktree', 'add', '-q', path.join(root, 'wt'));
});

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe('Project.fromDirectory with a .git file', () => {
  test('a git worktree is detected without an unhandled rejection', () => {
    const first = detect(path.join(root, 'wt'));
    expect(first.output).not.toContain('ENOTDIR');
    expect(first.status).toBe(0);
    expect(first.project).toEqual({
      id: rootCommit,
      worktree: toplevel(path.join(root, 'wt')),
    });
    // The id is cached in the common git directory, like upstream.
    expect(
      fs.readFileSync(path.join(root, 'main', '.git', 'opencode'), 'utf8')
    ).toBe(rootCommit);

    // Second run reads the cache and gives the same id.
    const second = detect(path.join(root, 'wt'));
    expect(second.status).toBe(0);
    expect(second.project?.id).toBe(rootCommit);
  });

  test('a normal repository still caches the id in .git/opencode', () => {
    const result = detect(path.join(root, 'main'));
    expect(result.status).toBe(0);
    expect(result.project).toEqual({
      id: rootCommit,
      worktree: toplevel(path.join(root, 'main')),
    });
    expect(
      fs.readFileSync(path.join(root, 'main', '.git', 'opencode'), 'utf8')
    ).toBe(rootCommit);
  });

  test('a broken .git file does not crash detection', () => {
    const broken = path.join(root, 'broken');
    fs.mkdirSync(broken);
    fs.writeFileSync(
      path.join(broken, '.git'),
      `gitdir: ${path.join(root, 'missing')}\n`
    );
    const result = detect(broken);
    expect(result.output).not.toContain('UnhandledRejection');
    expect(result.status).toBe(0);
  });
});
