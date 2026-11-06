#!/usr/bin/env node
/**
 * Find the jobs of a workflow run that GitHub never started, and rerun them.
 *
 * When no hosted runner can be acquired (usually macOS arm64 under capacity
 * constraints) GitHub gives up with "The job was not acquired by Runner of
 * type hosted even after multiple attempts". The job ends `cancelled` or
 * `failure` with no runner name and no steps: no code ran, so the result
 * says nothing about the commit.
 *
 * Modes:
 *
 * - `rerun` (default; .github/workflows/rerun-unacquired.yml): reads the
 *   `workflow_run` event and calls "rerun failed jobs" for a failed run whose
 *   failure is fully explained by unacquired jobs. It does nothing when
 *   - no job is unacquired;
 *   - another job failed after running steps (a real failure is never
 *     rerun, and rerunning cannot turn that run green);
 *   - the run already reached its attempt limit, was rerun by someone else,
 *     or a newer run of the same workflow, branch and event exists.
 *   Status gates (`Pipeline Status`) fail because of the jobs they need, so
 *   their own failure does not block the rerun; it is rerun as a dependent.
 * - `report` (scripts/check-pipeline-status.sh): prints the unacquired jobs
 *   of the current attempt, one name per line. JOBS_JSON (a jobs API
 *   response) replaces the API request in tests.
 */
import { readFileSync } from 'node:fs';
import { URLSearchParams, pathToFileURL } from 'node:url';
import { describe, githubApi } from './github-api.mjs';

export const GATE_JOBS = ['Pipeline Status'];
export const MAX_ATTEMPTS = 3;
const FAILED = new Set(['failure', 'cancelled', 'timed_out']);

/** A job GitHub gave up on before any runner picked it up. */
export function isUnacquired(job) {
  return (
    (job?.conclusion === 'cancelled' || job?.conclusion === 'failure') &&
    !job.runner_name &&
    (job.steps ?? []).length === 0
  );
}

/**
 * Split the failed jobs of one attempt.
 * @returns {{unacquired: string[], failed: string[]}} `failed` are the jobs
 *   that ran and failed, other than status gates.
 */
export function classifyJobs(jobs, { gateJobs = GATE_JOBS } = {}) {
  const unacquired = [];
  const failed = [];
  for (const job of jobs) {
    if (isUnacquired(job)) {
      unacquired.push(job.name);
    } else if (FAILED.has(job.conclusion) && !gateJobs.includes(job.name)) {
      failed.push(job.name);
    }
  }
  return { unacquired, failed };
}

/** Every job of one run attempt, following pagination. */
export async function listJobs(request, { repository, runId, attempt }) {
  const jobs = [];
  for (let page = 1; ; page++) {
    const body = await request(
      'GET',
      `/repos/${repository}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100&page=${page}`
    );
    const batch = body?.jobs ?? [];
    jobs.push(...batch);
    if (batch.length < 100 || jobs.length >= (body.total_count ?? 0)) {
      return jobs;
    }
  }
}

/** Why the run must be left alone, or '' when it can be rerun. */
async function reasonToSkip(request, repository, run, maxAttempts) {
  if (run.conclusion !== 'failure') {
    return `the run concluded ${run.conclusion}, not failure`;
  }
  if (run.run_attempt >= maxAttempts) {
    return `attempt ${run.run_attempt} reached the limit of ${maxAttempts}`;
  }
  const current = await request(
    'GET',
    `/repos/${repository}/actions/runs/${run.id}`
  );
  if (current.status !== 'completed' || current.run_attempt > run.run_attempt) {
    return `the run was already rerun (attempt ${current.run_attempt}, ${current.status})`;
  }
  if (!run.head_branch || !run.workflow_id) {
    return '';
  }
  const query = new URLSearchParams({
    branch: run.head_branch,
    event: run.event,
    per_page: '1',
  });
  const { workflow_runs: latest = [] } = await request(
    'GET',
    `/repos/${repository}/actions/workflows/${run.workflow_id}/runs?${query}`
  );
  if (latest[0] && latest[0].id > run.id) {
    return `newer run ${latest[0].id} of ${run.head_branch} supersedes it`;
  }
  return '';
}

/**
 * Decide on and perform the rerun of one completed run.
 * @returns {Promise<{action: 'rerun'|'skip', reason: string, unacquired: string[], failed: string[]}>}
 */
export async function rerunUnacquired({
  request,
  repository,
  run,
  maxAttempts = MAX_ATTEMPTS,
  gateJobs = GATE_JOBS,
  log = console.log,
}) {
  const label = `${run.name ?? 'workflow'} run ${run.id} attempt ${run.run_attempt}`;
  let reason = await reasonToSkip(request, repository, run, maxAttempts);
  let unacquired = [];
  let failed = [];
  if (!reason) {
    const jobs = await listJobs(request, {
      repository,
      runId: run.id,
      attempt: run.run_attempt,
    });
    ({ unacquired, failed } = classifyJobs(jobs, { gateJobs }));
    if (unacquired.length === 0) {
      reason = 'every failed job ran on a runner';
    } else if (failed.length > 0) {
      reason = `${failed.join(', ')} failed after running steps; fix them and push`;
    }
  }
  if (unacquired.length > 0) {
    log(
      `::warning title=Hosted runner not acquired::${label}: ${unacquired.join(', ')}. GitHub could not provide a runner; no code ran.`
    );
  }
  if (reason) {
    log(`Not rerunning ${label}: ${reason}.`);
    return { action: 'skip', reason, unacquired, failed };
  }
  await request(
    'POST',
    `/repos/${repository}/actions/runs/${run.id}/rerun-failed-jobs`
  );
  log(
    `Reran the failed jobs of ${label} (${unacquired.join(', ')} and their dependents).`
  );
  return { action: 'rerun', reason: '', unacquired, failed };
}

/** The unacquired jobs of the current attempt, for the status gate. */
export async function reportUnacquired(env, request) {
  const body = env.JOBS_JSON
    ? { jobs: JSON.parse(env.JOBS_JSON).jobs ?? [] }
    : {
        jobs: await listJobs(request, {
          repository: env.GITHUB_REPOSITORY,
          runId: env.GITHUB_RUN_ID,
          attempt: env.GITHUB_RUN_ATTEMPT || '1',
        }),
      };
  return body.jobs.filter(isUnacquired).map((job) => job.name);
}

function client(env) {
  return githubApi({
    token: env.GITHUB_TOKEN || env.GH_TOKEN,
    apiUrl: env.GITHUB_API_URL || undefined,
  });
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const mode = argv[0] || 'rerun';
  if (mode === 'report') {
    const names = await reportUnacquired(
      env,
      env.JOBS_JSON ? null : client(env)
    );
    for (const name of names) {
      console.log(name);
    }
    return;
  }
  if (mode !== 'rerun') {
    throw new Error(`Unknown mode: ${mode} (expected rerun or report)`);
  }
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  if (!event.workflow_run) {
    throw new Error('The event has no workflow_run; run this on workflow_run.');
  }
  await rerunUnacquired({
    request: client(env),
    repository: env.GITHUB_REPOSITORY,
    run: event.workflow_run,
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    const message = describe(error);
    // The status gate wraps a report failure in its own warning.
    if (process.argv[2] === 'report') {
      console.error(message);
    } else {
      console.log(
        `::error title=Rerun of unacquired jobs failed::${message
          .replaceAll('%', '%25')
          .replaceAll('\r', '%0D')
          .replaceAll('\n', '%0A')}`
      );
    }
    process.exitCode = 1;
  });
}
