import { afterEach, describe, test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyJobs,
  evaluateCancelInProgress,
  readJobCancelInProgress,
} from '../../scripts/job-cancel-policy.mjs';

/**
 * Tests for scripts/check-pipeline-status.sh and scripts/job-cancel-policy.mjs.
 *
 * The false negatives they prevent:
 * - GitHub reports a job killed by `timeout-minutes` as cancelled rather than
 *   failed. Every gate of this pipeline is written as
 *   `needs.<job>.result == 'success'`, so a cancelled check skips the release
 *   instead of failing the run (issue #301).
 * - Off main every cancellation used to be a warning, so a test that timed
 *   out on a pull request left the gate green, and only `failure` counted, so
 *   any other unsuccessful result passed (issue #337).
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = join(repoRoot, 'scripts', 'check-pipeline-status.sh');

const WORKFLOW = `name: Demo
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    concurrency:
      group: check-\${{ github.ref }}-test
      cancel-in-progress: \${{ github.ref != 'refs/heads/main' }}
    steps: []

  # The release queues behind an older run instead of cancelling it.
  release:
    runs-on: ubuntu-latest
    concurrency:
      group: release
      cancel-in-progress: false
    steps: []

  lint:
    runs-on: ubuntu-latest
    steps: []
`;

const RUN_SHA = 'a'.repeat(40);
const NEWER_SHA = 'b'.repeat(40);
const roots = [];

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'pipeline-status-'));
  roots.push(dir);
  return dir;
}

function workflowFile(body = WORKFLOW) {
  const file = join(tempDir(), 'demo.yml');
  writeFileSync(file, body);
  return file;
}

function run(needs, { cwd, ...extraEnv } = {}) {
  const env = { ...process.env, ...extraEnv };
  for (const key of [
    'BRANCH_HEAD_SHA',
    'GITHUB_WORKFLOW_REF',
    'PIPELINE_STATUS_VERBOSE',
  ]) {
    if (!(key in extraEnv)) {
      delete env[key];
    }
  }
  if (needs !== undefined) {
    env.NEEDS_JSON = JSON.stringify(needs);
  } else {
    delete env.NEEDS_JSON;
  }
  const result = spawnSync('bash', [script], { encoding: 'utf8', env, cwd });
  return {
    status: result.status,
    output: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

// A run of the `test` job on a pull request whose head moved (or not).
function pullRequestRun(needs, { headSha, ...env } = {}) {
  return run(needs, {
    RUN_SHA,
    HEAD_REF: 'refs/pull/7/head',
    BRANCH_HEAD_SHA: headSha,
    GITHUB_REF: 'refs/pull/7/merge',
    WORKFLOW_FILE: workflowFile(),
    ...env,
  });
}

afterEach(() => {
  for (const dir of roots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('check-pipeline-status.sh', () => {
  test('passes when every job succeeded or was skipped', () => {
    const { status, output } = run({
      lint: { result: 'success' },
      test: { result: 'success' },
      release: { result: 'skipped' },
    });

    expect(status).toBe(0);
    expect(output).toContain('All required jobs succeeded');
  });

  test('fails and names the failing jobs', () => {
    const { status, output } = run({
      lint: { result: 'failure' },
      test: { result: 'success' },
      build: { result: 'failure' },
    });

    expect(status).toBe(1);
    expect(output).toContain('::error::Pipeline failed');
    expect(output).toContain('lint, build');
  });

  test('fails on any other unsuccessful result', () => {
    const { status, output } = run({ test: { result: 'timed_out' } });

    expect(status).toBe(1);
    expect(output).toContain('Failing jobs: test');
  });

  // The case this script exists for: `timeout-minutes` kills a job on main.
  test('fails on a cancelled job on main', () => {
    const { status, output } = run(
      { test: { result: 'cancelled' }, lint: { result: 'success' } },
      {
        RUN_SHA,
        HEAD_REF: 'refs/heads/main',
        BRANCH_HEAD_SHA: NEWER_SHA,
        GITHUB_REF: 'refs/heads/main',
        WORKFLOW_FILE: workflowFile(),
      }
    );

    expect(status).toBe(1);
    expect(output).toContain('::error::Pipeline has cancelled jobs: test');
  });

  test('fails on a job cancelled on a pull request nobody pushed to', () => {
    const { status, output } = pullRequestRun(
      { test: { result: 'cancelled' } },
      { headSha: RUN_SHA }
    );

    expect(status).toBe(1);
    expect(output).toContain('::error::Pipeline has cancelled jobs: test');
  });

  // A new push to the pull request cancels the older run through
  // `cancel-in-progress`, which must not turn the older run red.
  test('only warns about a job a newer push cancelled', () => {
    const { status, output } = pullRequestRun(
      { test: { result: 'cancelled' }, lint: { result: 'success' } },
      { headSha: NEWER_SHA }
    );

    expect(status).toBe(0);
    expect(output).toContain(
      '::warning::Cancelled jobs in a superseded run: test'
    );
  });

  test('fails on a cancelled job that does not cancel in progress', () => {
    const { status, output } = pullRequestRun(
      {
        test: { result: 'cancelled' },
        release: { result: 'cancelled' },
        lint: { result: 'cancelled' },
      },
      { headSha: NEWER_SHA }
    );

    expect(status).toBe(1);
    expect(output).toContain('superseded run: test');
    expect(output).toContain(
      '::error::Pipeline has cancelled jobs: release, lint'
    );
  });

  test('fails closed when the head of the ref cannot be resolved', () => {
    const { status, output } = pullRequestRun(
      { test: { result: 'cancelled' } },
      { GIT_REMOTE: join(tempDir(), 'missing.git') }
    );

    expect(status).toBe(1);
    expect(output).toContain('Could not resolve the head of refs/pull/7/head');
  });

  test('looks the head up with git ls-remote', () => {
    const remote = tempDir();
    const git = (...args) =>
      spawnSync(
        'git',
        ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args],
        { cwd: remote, encoding: 'utf8' }
      ).stdout.trim();
    git('init', '-q', '-b', 'feature');
    git('commit', '-q', '--allow-empty', '-m', 'newer');
    const head = git('rev-parse', 'HEAD');

    const { status, output } = pullRequestRun(
      { test: { result: 'cancelled' } },
      { GIT_REMOTE: remote, HEAD_REF: 'refs/heads/feature' }
    );

    expect(output).toContain(`refs/heads/feature is at ${head}`);
    expect(status).toBe(0);
  });

  test('reads the workflow named by GITHUB_WORKFLOW_REF and traces when verbose', () => {
    const { status, output } = pullRequestRun(
      { test: { result: 'cancelled' } },
      {
        cwd: repoRoot,
        headSha: NEWER_SHA,
        WORKFLOW_FILE: '',
        GITHUB_WORKFLOW_REF:
          'link-assistant/agent/.github/workflows/js.yml@refs/pull/7/merge',
        PIPELINE_STATUS_VERBOSE: '1',
      }
    );

    expect(output).toContain(
      "[pipeline-status] test: cancel-in-progress=${{ github.ref != 'refs/heads/main' }} -> true"
    );
    expect(status).toBe(0);
  });

  test('fails closed when the workflow file cannot be read', () => {
    const { status, output } = pullRequestRun(
      { test: { result: 'cancelled' } },
      { headSha: NEWER_SHA, WORKFLOW_FILE: join(tempDir(), 'gone.yml') }
    );

    expect(status).toBe(1);
    expect(output).toContain('Cannot read the workflow file');
  });

  test('refuses to run without NEEDS_JSON', () => {
    const { status, output } = run(undefined);

    expect(status).not.toBe(0);
    expect(output).toContain('NEEDS_JSON is required');
  });
});

describe('job-cancel-policy.mjs', () => {
  test('reads job-level and workflow-level cancel-in-progress', () => {
    expect(readJobCancelInProgress(WORKFLOW, 'test')).toBe(
      "${{ github.ref != 'refs/heads/main' }}"
    );
    expect(readJobCancelInProgress(WORKFLOW, 'release')).toBe('false');
    expect(readJobCancelInProgress(WORKFLOW, 'lint')).toBe('none');
    expect(readJobCancelInProgress(WORKFLOW, 'deploy')).toBe('missing');

    const workflowLevel = WORKFLOW.replace(
      'jobs:\n',
      'concurrency:\n  group: all\n  cancel-in-progress: true\n\njobs:\n'
    );
    expect(readJobCancelInProgress(workflowLevel, 'lint')).toBe('true');
  });

  test('evaluates the github.ref comparisons this repository uses', () => {
    const offMain = "${{ github.ref != 'refs/heads/main' }}";
    expect(evaluateCancelInProgress(offMain, 'refs/pull/7/merge')).toBe(true);
    expect(evaluateCancelInProgress(offMain, 'refs/heads/main')).toBe(false);
    expect(
      evaluateCancelInProgress(
        "${{ github.ref == 'refs/heads/main' }}",
        'refs/heads/main'
      )
    ).toBe(true);
    expect(
      evaluateCancelInProgress('${{ github.event_name == "push" }}', 'x')
    ).toBeNull();
  });

  // Every job the gates observe must have a readable cancel-in-progress, or
  // a superseded run would fail closed and turn pull requests red.
  for (const file of ['js.yml', 'rust.yml']) {
    test(`every job of ${file} has an evaluable cancel-in-progress`, () => {
      const body = readFileSync(
        join(repoRoot, '.github', 'workflows', file),
        'utf8'
      );
      const jobs = Array.from(
        body
          .slice(body.indexOf('\njobs:\n'))
          .matchAll(/^ {2}([a-zA-Z0-9_-]+):/gm),
        (match) => match[1]
      );
      expect(jobs.length).toBeGreaterThan(3);
      for (const { job, value, cancellable } of classifyJobs(
        body,
        jobs,
        'refs/pull/1/merge'
      )) {
        expect({ job, value, cancellable: cancellable !== null }).toEqual({
          job,
          value,
          cancellable: true,
        });
      }
    });
  }
});
