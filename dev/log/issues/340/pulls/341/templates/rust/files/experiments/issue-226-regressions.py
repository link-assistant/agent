#!/usr/bin/env python3
"""Offline regressions for issue #226: jobs GitHub never handed to a runner.

A fake `gh` (selected through GH_BIN) serves recorded-shape API responses, so
neither the rerun decision nor the status-gate report needs network access.
The fixtures mirror run 40954664492 (Desktop Release, "Build macos-arm64":
cancelled, no steps, empty runner_name, "not acquired" annotation).
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts' / 'unacquired-jobs.py'
GATE = ROOT / 'scripts' / 'check-pipeline-status.sh'
WORKFLOW = ROOT / '.github' / 'workflows' / 'rerun-infrastructure-failures.yml'
REPO = 'owner/repo'
RUN_ID = 40954664492
NOT_ACQUIRED = 'The job was not acquired by Runner of type hosted even after multiple attempts'

FAKE_GH = textwrap.dedent('''\
    #!/usr/bin/env python3
    import json, os, sys
    state = json.load(open(os.environ['FAKE_GH_STATE']))
    with open(os.environ['FAKE_GH_LOG'], 'a') as log:
        log.write(json.dumps(sys.argv[1:]) + '\\n')
    args = sys.argv[1:]
    if args[:2] == ['run', 'rerun']:
        sys.exit(state.get('rerun_exit', 0))
    path = next(a for a in args[1:] if a.startswith('repos/'))
    if state.get('api_fails'):
        sys.stderr.write('HTTP 403: Resource not accessible by integration\\n'); sys.exit(1)
    if '/attempts/' in path:
        out = [{'jobs': state['jobs']}] if '--slurp' in args else {'jobs': state['jobs']}
    elif path.startswith('repos/owner/repo/check-runs/'):
        out = state['annotations'].get(path.split('/')[4], [])
    elif '/actions/workflows/' in path:
        out = {'workflow_runs': [{'id': state.get('newest_run', %d)}]}
    else:
        out = {'id': %d, 'workflow_id': 7, 'head_branch': 'main', 'event': 'push'}
    print(json.dumps(out))
    ''' % (RUN_ID, RUN_ID))


def job(job_id, name, conclusion, steps=0, runner=''):
    return {'id': job_id, 'name': name, 'conclusion': conclusion, 'runner_name': runner,
            'steps': [{'name': f'step {i}'} for i in range(steps)]}


UNACQUIRED = job(1, 'Build macos-arm64', 'cancelled')
REAL_FAILURE = job(2, 'Build linux-x64', 'failure', steps=5, runner='GitHub Actions 3')
SUPERSEDED_QUEUED = job(3, 'Build windows-x64', 'cancelled')
SUCCESS = job(4, 'Resolve', 'success', steps=3, runner='GitHub Actions 1')


class UnacquiredJobs(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='issue-226-')
        self.addCleanup(temp.cleanup)
        self.dir = Path(temp.name)
        self.gh = self.dir / 'gh'
        self.gh.write_text(FAKE_GH)
        self.gh.chmod(0o755)
        self.state = self.dir / 'state.json'
        self.log = self.dir / 'log'
        self.log.touch()

    def serve(self, jobs, annotations=None, **extra):
        self.state.write_text(json.dumps({'jobs': jobs, 'annotations': annotations or {}, **extra}))

    def env(self, **extra):
        env = {k: v for k, v in os.environ.items() if not k.startswith(('GITHUB_', 'GH_'))}
        env.update(GH_BIN=str(self.gh), FAKE_GH_STATE=str(self.state), FAKE_GH_LOG=str(self.log))
        env.update(extra)
        return env

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def reruns(self):
        return [c for c in self.calls() if c[:2] == ['run', 'rerun']]

    def unacquired_jobs(self, command, attempt=1, *extra):
        return subprocess.run([sys.executable, '-I', str(SCRIPT), command, '--repository', REPO,
                               '--run-id', str(RUN_ID), '--attempt', str(attempt), *extra],
                              capture_output=True, text=True, env=self.env(), timeout=30)

    # --- rerun ---------------------------------------------------------------

    def test_reruns_a_run_whose_job_never_got_a_runner(self):
        self.serve([SUCCESS, UNACQUIRED], {'1': [{'message': NOT_ACQUIRED}]})
        p = self.unacquired_jobs('rerun', 1)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn('::warning title=Hosted runner not acquired::Build macos-arm64 (attempt 1)', p.stdout)
        self.assertEqual(self.reruns(), [['run', 'rerun', str(RUN_ID), '--failed', '--repo', REPO]])
        self.assertTrue(any(f'attempts/1/jobs' in ' '.join(c) for c in self.calls()))

    def test_second_attempt_is_still_rerun(self):
        self.serve([UNACQUIRED], {'1': [{'message': NOT_ACQUIRED}]})
        p = self.unacquired_jobs('rerun', 2)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(len(self.reruns()), 1)

    def test_third_attempt_gives_up_loudly_with_the_manual_command(self):
        self.serve([UNACQUIRED], {'1': [{'message': NOT_ACQUIRED}]})
        p = self.unacquired_jobs('rerun', 3)
        self.assertEqual(p.returncode, 1, p.stdout)
        self.assertIn('::error title=Hosted runner not acquired::Build macos-arm64 found no hosted '
                      'runner in 3 attempts', p.stdout)
        self.assertIn(f'gh run rerun {RUN_ID} --failed --repo {REPO}', p.stdout)
        self.assertEqual(self.reruns(), [])

    def test_a_job_that_ran_steps_and_failed_is_never_rerun(self):
        self.serve([REAL_FAILURE], {'2': [{'message': NOT_ACQUIRED}]})
        p = self.unacquired_jobs('rerun', 1)
        self.assertEqual(p.returncode, 0, p.stdout)
        self.assertIn('leaving the run as it is', p.stdout)
        self.assertEqual(self.reruns(), [])
        # Its annotations are not even fetched: it ran, so it was acquired.
        self.assertFalse(any('check-runs' in ' '.join(c) for c in self.calls()))

    def test_a_queued_job_cancelled_without_the_annotation_is_not_rerun(self):
        # A supersede also cancels queued jobs that never got a runner.
        self.serve([REAL_FAILURE, SUPERSEDED_QUEUED], {'3': [{'message': 'The operation was canceled.'}]})
        p = self.unacquired_jobs('rerun', 1)
        self.assertEqual(p.returncode, 0, p.stdout)
        self.assertEqual(self.reruns(), [])

    def test_failure_conclusion_with_the_annotation_also_counts(self):
        self.serve([job(5, 'Build macos-x64', 'failure')], {'5': [{'message': NOT_ACQUIRED}]})
        p = self.unacquired_jobs('rerun', 1)
        self.assertEqual(p.returncode, 0, p.stdout)
        self.assertEqual(len(self.reruns()), 1)

    def test_a_superseded_run_is_not_rerun(self):
        self.serve([UNACQUIRED], {'1': [{'message': NOT_ACQUIRED}]}, newest_run=RUN_ID + 1)
        p = self.unacquired_jobs('rerun', 1)
        self.assertEqual(p.returncode, 0, p.stdout)
        self.assertIn('a newer run of this workflow exists', p.stdout)
        self.assertEqual(self.reruns(), [])

    def test_dry_run_does_not_rerun(self):
        self.serve([UNACQUIRED], {'1': [{'message': NOT_ACQUIRED}]})
        p = self.unacquired_jobs('rerun', 1, '--dry-run')
        self.assertEqual(p.returncode, 0, p.stdout)
        self.assertIn('Dry run', p.stdout)
        self.assertEqual(self.reruns(), [])

    def test_api_errors_fail_the_rerun_job(self):
        self.serve([UNACQUIRED], api_fails=True)
        p = self.unacquired_jobs('rerun', 1)
        self.assertNotEqual(p.returncode, 0)
        self.assertIn('Resource not accessible', p.stderr)

    # --- list and the status gate ------------------------------------------

    def test_list_prints_only_unacquired_jobs(self):
        self.serve([SUCCESS, REAL_FAILURE, UNACQUIRED, SUPERSEDED_QUEUED],
                   {'1': [{'message': NOT_ACQUIRED}], '3': []})
        p = self.unacquired_jobs('list', 1)
        self.assertEqual((p.returncode, p.stdout), (0, 'Build macos-arm64\n'), p.stderr)

    def test_list_is_best_effort_when_the_api_is_unavailable(self):
        self.serve([], api_fails=True)
        p = self.unacquired_jobs('list', 1)
        self.assertEqual((p.returncode, p.stdout), (0, ''))
        self.assertIn('Could not inspect jobs', p.stderr)

    def gate(self, needs, **extra):
        env = self.env(NEEDS_JSON=json.dumps(needs), RUN_SHA='a' * 40, BRANCH_HEAD_SHA='a' * 40,
                       WORKFLOW_FILE=str(ROOT / '.github/workflows/desktop-release.yml'),
                       GITHUB_REF='refs/heads/main', **extra)
        return subprocess.run(['bash', str(GATE)], capture_output=True, text=True, env=env,
                              cwd=ROOT, timeout=60)

    def test_gate_names_the_unacquired_job_and_stays_red(self):
        self.serve([SUCCESS, UNACQUIRED], {'1': [{'message': NOT_ACQUIRED}]})
        p = self.gate({'resolve': {'result': 'success'}, 'build': {'result': 'cancelled'}},
                      GH_TOKEN='t', GITHUB_REPOSITORY=REPO, GITHUB_RUN_ID=str(RUN_ID),
                      GITHUB_RUN_ATTEMPT='2')
        self.assertEqual(p.returncode, 1, p.stdout)
        self.assertIn('::error title=Hosted runner not acquired::Build macos-arm64. GitHub could not '
                      'provide a runner, so no code ran', p.stdout)
        self.assertIn('rerun-infrastructure-failures.yml', p.stdout)
        self.assertTrue(any('attempts/2/jobs' in ' '.join(c) for c in self.calls()))

    def test_gate_reports_unacquired_jobs_behind_a_failure_result_too(self):
        self.serve([job(5, 'Build macos-x64', 'failure')], {'5': [{'message': NOT_ACQUIRED}]})
        p = self.gate({'build': {'result': 'failure'}}, GH_TOKEN='t', GITHUB_REPOSITORY=REPO,
                      GITHUB_RUN_ID=str(RUN_ID))
        self.assertEqual(p.returncode, 1, p.stdout)
        self.assertIn('Hosted runner not acquired::Build macos-x64', p.stdout)

    def test_gate_without_a_token_behaves_as_before(self):
        self.serve([UNACQUIRED], {'1': [{'message': NOT_ACQUIRED}]})
        p = self.gate({'build': {'result': 'failure'}})
        self.assertEqual(p.returncode, 1, p.stdout)
        self.assertNotIn('Hosted runner not acquired', p.stdout)
        self.assertEqual(self.calls(), [])

    def test_gate_does_not_query_the_api_for_a_green_run(self):
        self.serve([SUCCESS])
        p = self.gate({'build': {'result': 'success'}}, GH_TOKEN='t', GITHUB_REPOSITORY=REPO,
                      GITHUB_RUN_ID=str(RUN_ID))
        self.assertEqual(p.returncode, 0, p.stdout)
        self.assertEqual(self.calls(), [])

    def test_gate_survives_an_unreadable_api(self):
        self.serve([], api_fails=True)
        p = self.gate({'build': {'result': 'failure'}}, GH_TOKEN='t', GITHUB_REPOSITORY=REPO,
                      GITHUB_RUN_ID=str(RUN_ID))
        self.assertEqual(p.returncode, 1, p.stdout)
        self.assertIn('Pipeline failed::Failing jobs: build', p.stdout)

    # --- wiring ------------------------------------------------------------

    def test_rerun_workflow_watches_every_gated_workflow_but_itself(self):
        text = WORKFLOW.read_text()
        gated = []
        for path in sorted((ROOT / '.github/workflows').glob('*.yml')):
            body = path.read_text()
            if 'bash scripts/check-pipeline-status.sh' in body and path != WORKFLOW:
                gated.append(body.splitlines()[0].removeprefix('name: ').strip())
                self.assertIn('GH_TOKEN: ${{ github.token }}', body, path.name)
                self.assertIn('      actions: read\n      checks: read\n', body, path.name)
        self.assertGreaterEqual(len(gated), 6)
        for name in gated:
            self.assertIn(f'      - {name}\n', text)
        self.assertNotIn('      - Rerun infrastructure failures\n', text)
        self.assertIn("if: github.event.workflow_run.conclusion == 'failure'", text)
        self.assertIn('actions: write', text)
        self.assertIn('persist-credentials: false', text)
        self.assertIn('python3 scripts/unacquired-jobs.py rerun', text)


if __name__ == '__main__':
    unittest.main()
