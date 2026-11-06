#!/usr/bin/env python3
"""Find and rerun jobs that GitHub never handed to a hosted runner (issue #226).

When hosted capacity runs out (macOS arm64 is the usual case) GitHub gives up
on a queued job with the check-run annotation "The job was not acquired by
Runner of type hosted even after multiple attempts". The job ends `cancelled`
(sometimes `failure`) with no steps and an empty `runner_name`: no code ran.

A job counts as unacquired only when all three hold:
  * its conclusion is `cancelled` or `failure`;
  * it has no steps and no runner;
  * one of its check-run annotations carries the "not acquired" message.
The annotation is required so that a queued job cancelled by a supersede, which
also has no runner and no steps, is never mistaken for a capacity failure.

Subcommands:
  list   print the unacquired jobs of one run attempt (used by
         check-pipeline-status.sh to name the cause; never fails the caller)
  rerun  rerun the failed jobs of a completed run when, and only when, its
         failure includes an unacquired job, the run is still the newest run of
         its workflow for that branch and event, and fewer than --max-attempts
         attempts were made (used by rerun-infrastructure-failures.yml)

Set UNACQUIRED_JOBS_VERBOSE=1 for a trace on stderr. GH_BIN overrides the gh
executable (the offline tests use a fake).
"""
import argparse
import json
import os
import subprocess
import sys

NOT_ACQUIRED = 'was not acquired by Runner'
MAX_ATTEMPTS = 3


def trace(message):
    if os.environ.get('UNACQUIRED_JOBS_VERBOSE') == '1':
        print(f'[unacquired-jobs] {message}', file=sys.stderr)


def gh(*args):
    command = [os.environ.get('GH_BIN', 'gh'), *args]
    trace('run: ' + ' '.join(command))
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode:
        raise RuntimeError(f"gh {' '.join(args[:2])} failed: {result.stderr.strip()}")
    return result.stdout


def gh_json(*args):
    return json.loads(gh(*args) or 'null')


def never_started(job):
    """Structural signal: a finished job with no runner and no steps."""
    return (job.get('conclusion') in ('cancelled', 'failure')
            and not (job.get('runner_name') or '')
            and not job.get('steps'))


def unacquired(jobs, annotations):
    """Names of jobs that never started and carry the "not acquired" annotation.

    `annotations` maps a job id to the messages of its check-run annotations.
    """
    return [job['name'] for job in jobs
            if never_started(job)
            and any(NOT_ACQUIRED in message for message in annotations.get(job['id'], []))]


def decide(names, attempt, newest, max_attempts=MAX_ATTEMPTS):
    """Return 'nothing', 'superseded', 'give-up' or 'rerun'."""
    if not names:
        return 'nothing'
    if not newest:
        return 'superseded'
    return 'rerun' if attempt < max_attempts else 'give-up'


def fetch_unacquired(repository, run_id, attempt):
    pages = gh_json('api', '--paginate', '--slurp',
                    f'repos/{repository}/actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100')
    jobs = [job for page in pages or [] for job in page.get('jobs', [])]
    annotations = {}
    for job in jobs:
        if never_started(job):
            found = gh_json('api', f"repos/{repository}/check-runs/{job['id']}/annotations")
            annotations[job['id']] = [item.get('message', '') for item in found or []]
            trace(f"{job['name']}: {annotations[job['id']]}")
    return unacquired(jobs, annotations)


def is_newest_run(repository, run_id):
    """True when no later run of the same workflow exists for its branch and event.

    Rerunning an older run on main could release a commit that a newer push
    has already replaced, so a superseded run is left alone.
    """
    run = gh_json('api', f'repos/{repository}/actions/runs/{run_id}')
    latest = gh_json('api', '-X', 'GET', f"repos/{repository}/actions/workflows/{run['workflow_id']}/runs",
                     '-f', f"branch={run['head_branch']}", '-f', f"event={run['event']}",
                     '-f', 'per_page=1')
    runs = (latest or {}).get('workflow_runs') or []
    trace(f"newest run for {run['head_branch']}/{run['event']}: {runs[0]['id'] if runs else None}")
    return bool(runs) and int(runs[0]['id']) == int(run_id)


def command_list(options):
    try:
        names = fetch_unacquired(options.repository, options.run_id, options.attempt)
    except (RuntimeError, ValueError, KeyError, TypeError) as error:
        # Reporting is best effort: the gate already fails on the job result.
        print(f'Could not inspect jobs for runner acquisition: {error}', file=sys.stderr)
        return 0
    for name in names:
        print(name)
    return 0


def command_rerun(options):
    names = fetch_unacquired(options.repository, options.run_id, options.attempt)
    newest = bool(names) and is_newest_run(options.repository, options.run_id)
    verdict = decide(names, options.attempt, newest, options.max_attempts)
    listed = ', '.join(names)
    manual = f'gh run rerun {options.run_id} --failed --repo {options.repository}'
    if verdict == 'nothing':
        print(f'Attempt {options.attempt}: every job reached a runner, so the failure is not '
              'infrastructure; leaving the run as it is.')
    elif verdict == 'superseded':
        print(f'::notice title=Hosted runner not acquired::{listed} (attempt {options.attempt}); '
              'a newer run of this workflow exists for the same branch, so this run is not rerun.')
    elif verdict == 'give-up':
        print(f'::error title=Hosted runner not acquired::{listed} found no hosted runner in '
              f'{options.attempt} attempts. GitHub runner capacity is outside this repository; '
              f'rerun it later with `{manual}`.')
        return 1
    else:
        print(f'::warning title=Hosted runner not acquired::{listed} (attempt {options.attempt}); '
              'rerunning the failed jobs and the jobs that depend on them.')
        if options.dry_run:
            print(f'Dry run: would execute `{manual}`.')
        else:
            gh('run', 'rerun', str(options.run_id), '--failed', '--repo', options.repository)
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('command', choices=['list', 'rerun'])
    parser.add_argument('--repository', required=True)
    parser.add_argument('--run-id', required=True, type=int)
    parser.add_argument('--attempt', required=True, type=int)
    parser.add_argument('--max-attempts', type=int, default=MAX_ATTEMPTS)
    parser.add_argument('--dry-run', action='store_true')
    options = parser.parse_args(argv)
    return command_list(options) if options.command == 'list' else command_rerun(options)


if __name__ == '__main__':
    sys.exit(main())
