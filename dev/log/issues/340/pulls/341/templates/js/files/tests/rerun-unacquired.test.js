import { describe, expect, it } from 'test-anywhere';
import { readFileSync } from 'node:fs';
import {
  GATE_JOBS,
  classifyJobs,
  isUnacquired,
  listJobs,
  reportUnacquired,
  rerunUnacquired,
} from '../scripts/rerun-unacquired.mjs';
import { HttpError } from '../scripts/github-api.mjs';

const REPO = 'owner/repo';
const RUN = {
  id: 100,
  name: 'Checks and release',
  run_attempt: 1,
  conclusion: 'failure',
  workflow_id: 7,
  head_branch: 'main',
  event: 'push',
};

const job = (name, conclusion, ran = true) => ({
  name,
  conclusion,
  runner_name: ran ? 'GitHub Actions 12' : '',
  steps: ran ? [{ name: 'Set up job', conclusion }] : [],
});

const notAcquired = job('test (macos-15, node)', 'cancelled', false);
const gate = job('Pipeline Status', 'failure');
const passed = job('lint', 'success');

/** A scripted GitHub API: every request must be expected. */
function api(routes) {
  const calls = [];
  const request = async (method, path) => {
    const key = `${method} ${path}`;
    calls.push(key);
    if (!(key in routes)) {
      throw new Error(`unexpected request: ${key}`);
    }
    const value = routes[key];
    if (value instanceof Error) {
      throw value;
    }
    return value;
  };
  return { request, calls };
}

function runRoutes({
  jobs,
  current = { status: 'completed', run_attempt: 1 },
  latest = [{ id: 100 }],
}) {
  return {
    'GET /repos/owner/repo/actions/runs/100': current,
    'GET /repos/owner/repo/actions/workflows/7/runs?branch=main&event=push&per_page=1':
      { workflow_runs: latest },
    'GET /repos/owner/repo/actions/runs/100/attempts/1/jobs?per_page=100&page=1':
      { total_count: jobs.length, jobs },
    'POST /repos/owner/repo/actions/runs/100/rerun-failed-jobs': {},
  };
}

async function decide(routes, run = RUN) {
  const { request, calls } = api(routes);
  const lines = [];
  const result = await rerunUnacquired({
    request,
    repository: REPO,
    run,
    log: (line) => lines.push(line),
  });
  return { result, calls, lines };
}

const RERUN = 'POST /repos/owner/repo/actions/runs/100/rerun-failed-jobs';

describe('unacquired job detection', () => {
  it('matches a job with no runner and no steps that GitHub gave up on', () => {
    expect(isUnacquired(notAcquired)).toBe(true);
    expect(isUnacquired({ ...notAcquired, conclusion: 'failure' })).toBe(true);
    expect(
      isUnacquired({ name: 'x', conclusion: 'cancelled', runner_name: null })
    ).toBe(true);
  });

  it('never matches a job that ran, or one that did not fail', () => {
    expect(isUnacquired(job('test', 'failure'))).toBe(false);
    expect(isUnacquired(job('test', 'cancelled'))).toBe(false);
    expect(
      isUnacquired({ ...notAcquired, runner_name: 'GitHub Actions 3' })
    ).toBe(false);
    expect(isUnacquired({ ...notAcquired, steps: [{ name: 'Set up' }] })).toBe(
      false
    );
    expect(isUnacquired(job('test', 'skipped', false))).toBe(false);
    expect(isUnacquired(job('test', 'success', false))).toBe(false);
  });

  it('separates unacquired jobs, real failures and status gates', () => {
    expect(GATE_JOBS).toEqual(['Pipeline Status']);
    expect(
      classifyJobs([
        passed,
        notAcquired,
        gate,
        job('build', 'failure'),
        job('slow', 'timed_out'),
        job('skipped', 'skipped', false),
      ])
    ).toEqual({
      unacquired: ['test (macos-15, node)'],
      failed: ['build', 'slow'],
    });
  });

  it('follows pagination of the jobs API', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) =>
      job(`j${i}`, 'success')
    );
    const { request, calls } = api({
      'GET /repos/owner/repo/actions/runs/5/attempts/2/jobs?per_page=100&page=1':
        { total_count: 101, jobs: page1 },
      'GET /repos/owner/repo/actions/runs/5/attempts/2/jobs?per_page=100&page=2':
        { total_count: 101, jobs: [notAcquired] },
    });
    const jobs = await listJobs(request, {
      repository: REPO,
      runId: 5,
      attempt: 2,
    });
    expect(jobs.length).toBe(101);
    expect(calls.length).toBe(2);
  });

  it('reports the unacquired jobs of an injected jobs response', async () => {
    const names = await reportUnacquired({
      JOBS_JSON: JSON.stringify({ jobs: [passed, notAcquired, gate] }),
    });
    expect(names).toEqual(['test (macos-15, node)']);
  });
});

describe('rerun of runs that never got a runner', () => {
  it('reruns failed jobs when unacquired jobs explain the failure', async () => {
    const { result, calls, lines } = await decide(
      runRoutes({ jobs: [passed, notAcquired, gate] })
    );
    expect(result.action).toBe('rerun');
    expect(result.unacquired).toEqual(['test (macos-15, node)']);
    expect(calls).toContain(RERUN);
    expect(lines[0]).toBe(
      '::warning title=Hosted runner not acquired::Checks and release run 100 attempt 1: test (macos-15, node). GitHub could not provide a runner; no code ran.'
    );
  });

  it('never reruns when a job failed after running steps', async () => {
    const { result, calls } = await decide(
      runRoutes({ jobs: [notAcquired, job('lint', 'failure'), gate] })
    );
    expect(result.action).toBe('skip');
    expect(result.reason).toMatch(/lint failed after running steps/);
    expect(calls).not.toContain(RERUN);
  });

  it('leaves a run alone when every failed job ran', async () => {
    const { result, calls, lines } = await decide(
      runRoutes({ jobs: [job('lint', 'failure'), gate] })
    );
    expect(result.reason).toBe('every failed job ran on a runner');
    expect(calls).not.toContain(RERUN);
    expect(lines.some((line) => line.startsWith('::warning'))).toBe(false);
  });

  it('stops at the attempt limit without calling the API', async () => {
    const { result, calls } = await decide({}, { ...RUN, run_attempt: 3 });
    expect(result.action).toBe('skip');
    expect(result.reason).toMatch(/attempt 3 reached the limit of 3/);
    expect(calls).toEqual([]);
  });

  it('ignores runs that did not fail', async () => {
    const { result, calls } = await decide(
      {},
      { ...RUN, conclusion: 'success' }
    );
    expect(result.action).toBe('skip');
    expect(calls).toEqual([]);
  });

  it('does not rerun a run someone already reran', async () => {
    const { result, calls } = await decide(
      runRoutes({
        jobs: [notAcquired],
        current: { status: 'in_progress', run_attempt: 2 },
      })
    );
    expect(result.reason).toMatch(/already rerun/);
    expect(calls).not.toContain(RERUN);
  });

  it('does not rerun a run a newer run of the branch supersedes', async () => {
    const { result, calls } = await decide(
      runRoutes({ jobs: [notAcquired], latest: [{ id: 101 }] })
    );
    expect(result.reason).toMatch(/newer run 101 of main supersedes it/);
    expect(calls).not.toContain(RERUN);
  });

  it('reruns a later attempt that again found no runner', async () => {
    const run = { ...RUN, run_attempt: 2 };
    const routes = runRoutes({
      jobs: [notAcquired],
      current: { status: 'completed', run_attempt: 2 },
    });
    routes[
      'GET /repos/owner/repo/actions/runs/100/attempts/2/jobs?per_page=100&page=1'
    ] = { total_count: 1, jobs: [notAcquired] };
    const { result } = await decide(routes, run);
    expect(result.action).toBe('rerun');
  });

  it('fails when GitHub refuses the rerun', async () => {
    const routes = runRoutes({ jobs: [notAcquired] });
    routes[RERUN] = new HttpError(403, 'Forbidden', {
      method: 'POST',
      path: '/rerun-failed-jobs',
    });
    let caught;
    try {
      await decide(routes);
    } catch (error) {
      caught = error;
    }
    expect(caught?.status).toBe(403);
  });
});

describe('rerun-unacquired workflow', () => {
  const workflow = readFileSync(
    '.github/workflows/rerun-unacquired.yml',
    'utf8'
  ).replaceAll('\r\n', '\n');

  it('watches every workflow that runs on its own', () => {
    for (const file of [
      'release.yml',
      'example-app.yml',
      'security.yml',
      'links.yml',
      'workflows.yml',
      'javascript-first-example.yml',
    ]) {
      const name = readFileSync(`.github/workflows/${file}`, 'utf8').match(
        /^name: (.+)$/m
      )[1];
      expect(workflow).toContain(`      - ${name}\n`);
    }
    expect(workflow).toContain(
      '  workflow_run: # zizmor: ignore[dangerous-triggers]\n'
    );
    expect(workflow).toContain('    types: [completed]\n');
  });

  it('runs only for failed runs below the attempt limit', () => {
    expect(workflow).toContain(
      "      github.event.workflow_run.conclusion == 'failure' &&\n      github.event.workflow_run.run_attempt < 3\n"
    );
    expect(workflow).toContain(
      '      group: rerun-unacquired-${{ github.event.workflow_run.id }}\n      cancel-in-progress: false\n'
    );
    expect(workflow).toContain('    timeout-minutes: 5\n');
  });

  it('escalates to actions: write only in the rerun job', () => {
    expect(workflow).toContain('\npermissions:\n  contents: read\n');
    expect(workflow).toContain(
      '    permissions:\n      actions: write\n      contents: read\n'
    );
    expect(workflow).toContain('persist-credentials: false');
    expect(workflow).not.toContain('workflow_run.head_sha');
    expect(workflow).not.toContain('ref:');
  });

  it('runs the tested script', () => {
    expect(workflow).toContain('run: node scripts/rerun-unacquired.mjs rerun');
    expect(workflow).toContain('GITHUB_TOKEN: ${{ github.token }}');
  });
});
