import { describe, expect } from 'test-anywhere';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { itUnless, noPosixShell, sandboxed } from './helpers/skip.js';

const scriptPath = fileURLToPath(
  new URL('../scripts/push-main-with-rebase-retry.mjs', import.meta.url)
);

function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed\nstdout:\n${
        result.stdout
      }\nstderr:\n${result.stderr}`
    );
  }

  return result;
}

function runGit(root, args) {
  return runCommand('git', args, root);
}

function configureGit(root) {
  runGit(root, ['config', 'user.email', 'ci@example.com']);
  runGit(root, ['config', 'user.name', 'CI Test']);
}

function commitAll(root, message) {
  runGit(root, ['add', '.']);
  runGit(root, ['commit', '-m', message]);
}

function createFile(root, filePath, contents) {
  const absolutePath = path.join(root, filePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents);
}

function writeExecutable(filePath, contents) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
  chmodSync(filePath, 0o755);
}

function runPushHelper(root, args = [], env = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

/**
 * Reject every direct push to main the way a `pull_request` ruleset does, so
 * the helper faces the verbatim GH013 output from the GH013 report in link-foundation/js-ai-driven-development-pipeline-template#143. The marker file
 * is the fake "bypass": only the simulated pull-request merge creates it.
 */
function installRulesetHook(remote, marker) {
  writeExecutable(
    path.join(remote, 'hooks', 'pre-receive'),
    [
      '#!/usr/bin/env bash',
      'while read -r _old _new ref; do',
      `  if [ "$ref" = "refs/heads/main" ] && [ ! -f "${marker}" ]; then`,
      '    echo "error: GH013: Repository rule violations found for $ref." >&2',
      '    echo "- Changes must be made through a pull request." >&2',
      '    exit 1',
      '  fi',
      'done',
      'exit 0',
      '',
    ].join('\n')
  );
}

/**
 * Stand in for the `gh` CLI: list finds nothing, create prints a URL, checks
 * records that validation completed, and the first merge call reports "not
 * mergeable" the way GitHub reports it while mergeability is still being
 * computed. The second call really merges the head branch into main.
 */
function installFakeGh({ binDir, remote, marker, stateDir }) {
  writeExecutable(
    path.join(binDir, 'gh'),
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      `state="${stateDir}"`,
      `remote="${remote}"`,
      `marker="${marker}"`,
      'mkdir -p "$state"',
      'if [ "${1:-}" = "pr" ] && [ "${2:-}" = "list" ]; then',
      '  echo ""',
      '  exit 0',
      'fi',
      'if [ "${1:-}" = "pr" ] && [ "${2:-}" = "create" ]; then',
      '  shift 2',
      '  while [ $# -gt 0 ]; do',
      '    if [ "$1" = "--head" ]; then echo "$2" > "$state/head"; fi',
      '    if [ "$1" = "--title" ]; then echo "$2" > "$state/title"; fi',
      '    shift',
      '  done',
      '  echo "https://example.invalid/pr/1"',
      '  exit 0',
      'fi',
      'if [ "${1:-}" = "pr" ] && [ "${2:-}" = "checks" ]; then',
      '  test "${GH_TOKEN:-}" = "dedicated-token"',
      '  touch "$state/checks-watched"',
      '  echo "Pipeline Status pass"',
      '  exit 0',
      'fi',
      'if [ "${1:-}" = "pr" ] && [ "${2:-}" = "merge" ]; then',
      '  test -f "$state/checks-watched"',
      '  attempts=$(cat "$state/merge-attempts" 2>/dev/null || echo 0)',
      '  attempts=$((attempts + 1))',
      '  echo "$attempts" > "$state/merge-attempts"',
      '  if [ "$attempts" -lt 2 ]; then',
      '    echo "Pull request is not mergeable: the merge commit cannot be cleanly created." >&2',
      '    exit 1',
      '  fi',
      '  head=$(cat "$state/head")',
      '  work="$state/merge-work"',
      '  rm -rf "$work"',
      '  git clone --quiet "$remote" "$work"',
      '  git -C "$work" config user.email ci@example.com',
      '  git -C "$work" config user.name "CI Test"',
      '  git -C "$work" checkout --quiet main',
      '  git -C "$work" merge --no-ff --no-edit "origin/$head" >/dev/null',
      '  touch "$marker"',
      '  git -C "$work" push --quiet origin HEAD:main',
      '  rm -f "$marker"',
      '  exit 0',
      'fi',
      'echo "unexpected gh invocation: $*" >&2',
      'exit 1',
      '',
    ].join('\n')
  );
}

describe('push-main-with-rebase-retry.mjs', () => {
  itUnless(sandboxed, noPosixShell)(
    'rebases and retries when a generated-artifact push races another main writer',
    () => {
      const root = mkdtempSync(path.join(tmpdir(), 'push-main-retry-'));
      const remote = path.join(root, 'remote.git');
      const previewWriter = path.join(root, 'preview-writer');
      const releaseWriter = path.join(root, 'release-writer');
      const verifier = path.join(root, 'verifier');

      try {
        runGit(root, ['init', '--bare', '--initial-branch=main', remote]);
        runGit(root, ['clone', remote, previewWriter]);
        configureGit(previewWriter);
        createFile(previewWriter, 'README.md', '# Fixture\n');
        commitAll(previewWriter, 'Initial commit');
        runGit(previewWriter, ['push', 'origin', 'HEAD:main']);

        runGit(root, ['clone', remote, releaseWriter]);
        configureGit(releaseWriter);

        createFile(
          previewWriter,
          'docs/screenshots/example-app/example-app.png',
          'new preview image\n'
        );
        commitAll(previewWriter, 'Regenerate preview images');

        createFile(releaseWriter, 'VERSION.txt', '1.0.1\n');
        commitAll(releaseWriter, 'Version bump');
        runGit(releaseWriter, ['push', 'origin', 'HEAD:main']);

        const result = runPushHelper(previewWriter);
        const output = `${result.stdout}\n${result.stderr}`;

        expect(result.status).toBe(0);
        expect(output).toContain('rebasing on origin/main before retry');
        expect(output).toContain('Push succeeded after rebase retry.');

        runGit(root, ['clone', remote, verifier]);
        const history = runGit(verifier, ['log', '--format=%s']).stdout;

        expect(history).toContain('Regenerate preview images');
        expect(history).toContain('Version bump');
        expect(
          readFileSync(
            path.join(verifier, 'docs/screenshots/example-app/example-app.png'),
            'utf8'
          )
        ).toBe('new preview image\n');
        expect(readFileSync(path.join(verifier, 'VERSION.txt'), 'utf8')).toBe(
          '1.0.1\n'
        );
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'lands the commit through a pull request when a ruleset declines the direct push',
    () => {
      const root = mkdtempSync(path.join(tmpdir(), 'push-main-ruleset-'));
      const remote = path.join(root, 'remote.git');
      const releaseWriter = path.join(root, 'release-writer');
      const verifier = path.join(root, 'verifier');
      const marker = path.join(root, 'allow-main-push');
      const binDir = path.join(root, 'bin');
      const stateDir = path.join(root, 'gh-state');

      try {
        runGit(root, ['init', '--bare', '--initial-branch=main', remote]);
        runGit(root, ['clone', remote, releaseWriter]);
        configureGit(releaseWriter);
        createFile(releaseWriter, 'README.md', '# Fixture\n');
        commitAll(releaseWriter, 'Initial commit');
        runGit(releaseWriter, ['push', 'origin', 'HEAD:main']);

        // The ruleset is added only now, exactly as it was added between two
        // release runs downstream (link-foundation/js-ai-driven-development-pipeline-template#143).
        installRulesetHook(remote, marker);
        installFakeGh({ binDir, remote, marker, stateDir });

        createFile(releaseWriter, 'VERSION.txt', '1.0.1\n');
        commitAll(releaseWriter, '1.0.1');

        const result = runPushHelper(
          releaseWriter,
          [
            'origin',
            'main',
            '--label',
            '1.0.1',
            '--merge-delay-ms',
            '0',
            '--merge-attempts',
            '5',
          ],
          {
            PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
            GITHUB_RUN_ID: '42',
            RELEASE_PR_TOKEN: 'dedicated-token',
          }
        );
        const output = `${result.stdout}\n${result.stderr}`;

        expect(result.status).toBe(0);
        // The rejection must never be reported (or retried) as a lost race.
        expect(output).not.toContain('rebasing on origin/main before retry');
        expect(output).toContain('declined by a repository rule');
        expect(output).toContain('Required checks passed');
        expect(output).toContain('merged into main');

        // The run-scoped branch name keeps every attempt on a fresh ref, so no
        // force-push or branch deletion is ever needed.
        expect(readFileSync(path.join(stateDir, 'head'), 'utf8').trim()).toBe(
          'release/1.0.1-42'
        );
        // GitHub reports "not mergeable" right after creation; the helper polls.
        expect(
          Number(readFileSync(path.join(stateDir, 'merge-attempts'), 'utf8'))
        ).toBe(2);

        runGit(root, ['clone', remote, verifier]);
        expect(readFileSync(path.join(verifier, 'VERSION.txt'), 'utf8')).toBe(
          '1.0.1\n'
        );

        // The local checkout is fast-forwarded to the merged base branch so the
        // publish steps in the same job see the merged tree.
        const localHead = runGit(releaseWriter, [
          'rev-parse',
          'HEAD',
        ]).stdout.trim();
        const remoteHead = runGit(verifier, [
          'rev-parse',
          'HEAD',
        ]).stdout.trim();
        expect(localHead).toBe(remoteHead);
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'fails fast on a rejection that neither a rebase nor a pull request can fix',
    () => {
      const root = mkdtempSync(path.join(tmpdir(), 'push-main-auth-'));
      const worker = path.join(root, 'worker');

      try {
        mkdirSync(worker, { recursive: true });
        runGit(root, ['init', '--initial-branch=main', worker]);
        configureGit(worker);
        createFile(worker, 'README.md', '# Fixture\n');
        commitAll(worker, 'Initial commit');
        runGit(worker, [
          'remote',
          'add',
          'origin',
          path.join(root, 'does-not-exist.git'),
        ]);

        const result = runPushHelper(worker);
        const output = `${result.stdout}\n${result.stderr}`;

        expect(result.status).toBe(1);
        expect(output).not.toContain('rebasing on origin/main before retry');
        expect(output).toContain('Command failed');
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    }
  );
});
