#!/usr/bin/env python3
"""Offline regressions for the combined pipeline repair; never publish anything."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / 'scripts'
WORKFLOWS = ROOT / '.github/workflows'


def run(args, cwd=ROOT, env=None, timeout=30):
    return subprocess.run(args, cwd=cwd, env={**os.environ, **(env or {})},
                          text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          timeout=timeout, check=False)


def job(text, name):
    match = re.search(rf'^  {re.escape(name)}:\n(.*?)(?=^  [\w-]+:\n|\Z)', text, re.M | re.S)
    if not match:
        raise AssertionError(f'Missing job {name}')
    return match[0]


class PipelineRegressions(unittest.TestCase):
    def test_workflow_repairs(self):
        release = (WORKFLOWS / 'release.yml').read_text()
        for path in WORKFLOWS.glob('*.yml'):
            text = path.read_text()
            with self.subTest(workflow=path.name):
                self.assertIn('GIT_CONFIG_KEY_0: init.defaultBranch', text)
                for action, major in [('checkout', 7), ('cache', 6),
                                      ('upload-artifact', 7), ('download-artifact', 8)]:
                    for ref in re.findall(rf'uses: actions/{action}@([^\s]+)', text):
                        self.assertTrue(ref.startswith(f'v{major}') or
                                        (action == 'checkout' and ref == '3d3c42e5aac5ba805825da76410c181273ba90b1'),
                                        (path, action, ref))
                self.assertNotIn('7e38f4b43b4db5c8dd498af069a4f6196df1d067', text)
                self.assertNotIn('windows-latest', text)
                dispatch = re.search(r'^  workflow_dispatch:\n(.*?)(?=^  [\w-]+:|^[^\s#]|\Z)',
                                     text, re.M | re.S)
                if dispatch:
                    inputs = re.findall(r'^      ([\w-]+):\n(.*?)(?=^      [\w-]+:\n|\Z)',
                                        dispatch[1], re.M | re.S)
                    for name, definition in inputs:
                        if re.search(r'^        required: true\s*$', definition, re.M):
                            self.assertRegex(definition, r'(?m)^        default: \S+',
                                             f'{path.name}: required dispatch input {name} has no default')
                if 'pipeline-status:' in text:
                    gate = job(text, 'pipeline-status')
                    self.assertIn('github.event.pull_request.head.sha || github.sha', gate)
                    self.assertIn("format('refs/pull/{0}/head'", gate)
        for name in ['auto-release', 'manual-release']:
            block = job(release, name)
            for dependency in ['coverage', 'docker-build', 'validate-docs', 'changelog', 'secrets-scan']:
                self.assertIn(dependency, block.split('outputs:')[0])
            self.assertIn("!contains(needs.*.result, 'failure')", block)
            self.assertIn("!contains(needs.*.result, 'cancelled')", block)
            self.assertIn('id-token: write', block)
            self.assertIn('rust-lang/crates-io-auth-action@c6f97d42243bad5fab37ca0427f495c86d5b1a18', block)
            self.assertIn('steps.crates_auth.outputs.token || secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN', block)
            self.assertLess(block.index('id: crates_auth'), block.index('name: Verify selected publishing credential'))
            self.assertLess(block.index('name: Verify selected publishing credential'), block.index('name: Build release'))
        for name in ['auto-release', 'manual-release', 'changelog-pr', 'deploy-docs']:
            block = job(release, name)
            self.assertIn('queue: max', block)
            self.assertIn('cancel-in-progress: false', block)
        self.assertIn('default: patch', release)
        self.assertIn('PR_AUTHOR: ${{ github.event.pull_request.user.login }}', release)
        self.assertIn('RELEASE_PR_TOKEN', job(release, 'changelog-pr'))
        self.assertIn('NODE_OPTIONS: --disable-warning=DEP0040', job(release, 'deploy-docs'))
        links = (WORKFLOWS / 'links.yml').read_text()
        self.assertIn('path: .lycheecache', links)
        self.assertIn('uses: actions/upload-artifact@v7', links)
        workflows = (WORKFLOWS / 'workflows.yml').read_text()
        self.assertIn('shellcheck-py==0.11.0.1', job(workflows, 'shellcheck'))
        self.assertIn('- shellcheck', job(workflows, 'pipeline-status'))
        pedantic = workflows.split('- name: Audit for pedantic-only')[1].split('\n  workflow-tools:')[0]
        self.assertIn('GH_TOKEN: ${{ github.token }}', pedantic)
        self.assertIn('dependency-graph', job((WORKFLOWS / 'security.yml').read_text(), 'dependency-review'))

    def test_multiline_merge_commands_run_on_merged_tree_and_restore_head(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            def git(*args):
                p = run(['git', '-c', 'user.name=test', '-c', 'user.email=test@example.org', *args], cwd=d)
                self.assertEqual(p.returncode, 0, p.stdout)
                return p.stdout.strip()
            git('init', '-q', '--bare', 'remote.git')
            git('init', '-q', '-b', 'main', 'work')
            d /= 'work'
            git('remote', 'add', 'origin', '../remote.git')
            (d / 'initial').write_text('initial')
            git('add', '.'); git('commit', '-qm', 'initial'); git('push', '-q', 'origin', 'main')
            git('checkout', '-qb', 'feature')
            (d / 'head file').write_text('head')
            git('add', '.'); git('commit', '-qm', 'head')
            head = git('rev-parse', 'HEAD')
            git('checkout', '-q', 'main')
            (d / 'base file').write_text('base')
            git('add', '.'); git('commit', '-qm', 'base'); git('push', '-q', 'origin', 'main')
            git('checkout', '-q', 'feature')
            # FETCH_HEAD must work even if the remote fetch mapping omits main.
            git('config', 'remote.origin.fetch', '+refs/heads/feature:refs/remotes/origin/feature')
            git('update-ref', '-d', 'refs/remotes/origin/main')
            env = {'GITHUB_BASE_REF': 'main', 'FRESH_MERGE_CHECKS':
                   '\ntest -f "base file"\ntest -f "head file"\n'}
            p = run(['bash', str(SCRIPTS / 'simulate-fresh-merge.sh')], cwd=d, env=env)
            self.assertEqual(p.returncode, 0, p.stdout)
            self.assertEqual(git('rev-parse', 'HEAD'), head)
            self.assertEqual(git('branch', '--show-current'), 'feature')
            env['FRESH_MERGE_CHECKS'] = 'false\nprintf complete > completed'
            p = run(['bash', str(SCRIPTS / 'simulate-fresh-merge.sh')], cwd=d, env=env)
            self.assertEqual(p.returncode, 1, p.stdout)
            self.assertTrue((d / 'completed').exists(), p.stdout)
            self.assertEqual(git('rev-parse', 'HEAD'), head)

    def test_budget_does_not_kill_an_in_budget_command(self):
        # Start 750ms into a second; SECONDS reaches 2 at ~1.25s.
        delay = (0.75 - time.time() % 1) % 1
        time.sleep(delay)
        p = run(['bash', str(SCRIPTS / 'run-with-budget-warning.sh'), '2',
                 'aligned regression', 'sleep', '1.4'], env={
                     'BUDGET_POLL_SECONDS': '0.05', 'BUDGET_GRACE_SECONDS': '1',
                     'BUDGET_SUDO_KILL': '0'})
        self.assertEqual(p.returncode, 0, p.stdout)

    def test_real_release_cancel_policies_and_unknowns_fail_closed(self):
        names = re.findall(r'^  ([\w-]+):$', (WORKFLOWS / 'release.yml').read_text(), re.M)
        for ref, expected in [('refs/pull/7/merge', 'true'), ('refs/heads/main', 'false')]:
            p = run(['bash', str(SCRIPTS / 'read-job-cancel-in-progress.sh'), *names], env={
                'WORKFLOW_FILE': str(WORKFLOWS / 'release.yml'), 'GITHUB_REF': ref})
            values = dict(line.split('\t') for line in p.stdout.splitlines())
            self.assertNotIn('unknown', values.values(), p.stdout)
            self.assertEqual(values['test'], expected)
        for ref, head, expected in [('refs/pull/7/merge', 'b'*40, 0),
                                    ('refs/heads/main', 'b'*40, 1),
                                    ('refs/pull/7/merge', 'a'*40, 1), ('', 'b'*40, 1)]:
            p = run(['bash', str(SCRIPTS / 'check-pipeline-status.sh')], env={
                'NEEDS_JSON': '{"test":{"result":"cancelled"}}', 'RUN_SHA': 'a'*40,
                'BRANCH_HEAD_SHA': head, 'GITHUB_REF': ref,
                'WORKFLOW_FILE': str(WORKFLOWS / 'release.yml')})
            self.assertEqual(p.returncode, expected, p.stdout)

    def test_pull_head_lookup_works_for_forks(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            for args in [['init', '-q', '-b', 'main'],
                         ['-c', 'user.name=t', '-c', 'user.email=t@e', 'commit', '-q', '--allow-empty', '-m', 'new'],
                         ['update-ref', 'refs/pull/7/head', 'HEAD']]:
                self.assertEqual(run(['git', *args], cwd=d).returncode, 0)
            env = {'NEEDS_JSON': '{"test":{"result":"cancelled"}}', 'RUN_SHA': 'a'*40,
                   'HEAD_REF': 'refs/pull/7/head', 'GIT_REMOTE': str(d),
                   'BRANCH_REF': 'absent-in-base', 'BRANCH_HEAD_SHA': '',
                   'GITHUB_REF': 'refs/pull/7/merge', 'WORKFLOW_FILE': str(WORKFLOWS / 'release.yml')}
            p = run(['bash', str(SCRIPTS / 'check-pipeline-status.sh')], env=env)
            self.assertEqual(p.returncode, 0, p.stdout)

    def test_only_supported_ref_comparisons_are_evaluated(self):
        cases = [("${{ github.ref == 'refs/heads/MAIN' }}", 'true'),
                 ("${{ github.ref != 'refs/heads/main' }}", 'false'),
                 ("${{ github.ref == 'refs/heads/main' || true }}", 'unknown'),
                 ("${{ github.event_name == 'push' }}", 'unknown'),
                 ("${{ contains(github.ref, 'main') }}", 'unknown')]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'workflow.yml'
            for expression, expected in cases:
                path.write_text('jobs:\n  check:\n    concurrency:\n      group: tests\n'
                                f'      cancel-in-progress: {expression}\n')
                p = run(['bash', str(SCRIPTS / 'read-job-cancel-in-progress.sh'), 'check'], env={
                    'WORKFLOW_FILE': str(path), 'GITHUB_REF': 'refs/heads/main'})
                self.assertEqual(p.stdout.strip(), f'check\t{expected}', p.stdout)

    def test_oidc_availability_does_not_replace_selected_token_proof(self):
        for phase, expected in [('availability', 0), ('publish', 1)]:
            p = run(['bash', str(SCRIPTS / 'preflight-credentials.sh')], env={
                'CRATES_PREFLIGHT_PHASE': phase, 'PREFLIGHT_MODE': 'release',
                'ACTIONS_ID_TOKEN_REQUEST_URL': 'https://example.invalid',
                'ACTIONS_ID_TOKEN_REQUEST_TOKEN': 'fixture-only',
                'CARGO_REGISTRY_TOKEN': '', 'CARGO_TOKEN': '',
                'DOCKERHUB_IMAGE': '', 'GITHUB_STEP_SUMMARY': ''})
            self.assertEqual(p.returncode, expected, p.stdout)

    def test_dependency_graph_classifies_retries_and_main_requirement(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            fake = d / 'gh'
            fake.write_text('#!/usr/bin/env python3\nimport json, os, pathlib, sys\np=pathlib.Path(os.environ["RESPONSES"])\nx=json.loads(p.read_text()); item=x.pop(0) if len(x)>1 else x[0]\np.write_text(json.dumps(x)); print(item[1]); sys.exit(item[0])\n')
            fake.chmod(0o755)
            scenarios = [('enabled', [[0, '{}']], 0),
                         ('disabled', [[1, 'gh: Forbidden (HTTP 403)']], 0),
                         ('enabled', [[1, 'API rate limit exceeded (HTTP 403)'], [0, '{}']], 0),
                         ('unknown', [[1, 'secondary rate limit (HTTP 403)']], 0),
                         ('unknown', [[1, 'Bad Gateway (HTTP 502)']], 0),
                         ('unknown', [[1, 'network error']], 0),
                         ('unknown', [[1, 'Not Found (HTTP 404)']], 0),
                         ('disabled', [[1, 'gh: Forbidden (HTTP 403)']], 1),
                         ('unknown', [[1, 'secondary rate limit (HTTP 403)']], 1)]
            for state, responses, required in scenarios:
                with self.subTest(state=state, responses=responses, required=required):
                    (d / 'responses').write_text(json.dumps(responses))
                    out = d / 'output'; out.write_text('')
                    p = run(['bash', str(SCRIPTS / 'check-dependency-graph.sh'), 'base', 'head',
                             *(['--require'] if required else [])], env={
                        'PATH': str(d)+os.pathsep+os.environ['PATH'], 'RESPONSES': str(d / 'responses'),
                        'REPO': 'owner/repo', 'GITHUB_OUTPUT': str(out),
                        'DEPENDENCY_GRAPH_RETRY_DELAY_SECONDS': '0'})
                    self.assertEqual(p.returncode, required, p.stdout)
                    self.assertIn(f'state={state}', out.read_text())
                    self.assertIn(f'enabled={str(state == "enabled").lower()}', out.read_text())
                    if state == 'unknown':
                        self.assertNotIn('Enable Dependency graph', p.stdout)


if __name__ == '__main__':
    unittest.main()
