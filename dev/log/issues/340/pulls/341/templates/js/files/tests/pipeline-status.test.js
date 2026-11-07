import { describe, it, expect } from 'test-anywhere';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { itUnless, noPosixShell, sandboxed } from './helpers/skip.js';

const workflow = readFileSync(
  '.github/workflows/release.yml',
  'utf8'
).replaceAll('\r\n', '\n');
const workflowNames = [
  'release.yml',
  'links.yml',
  'security.yml',
  'workflows.yml',
  'example-app.yml',
];
const gatedWorkflows = Object.fromEntries(
  workflowNames.map((name) => [
    name,
    readFileSync(`.github/workflows/${name}`, 'utf8').replaceAll('\r\n', '\n'),
  ])
);
const scriptPath = fileURLToPath(
  new URL('../scripts/check-pipeline-status.sh', import.meta.url)
);
const concurrencyReaderPath = fileURLToPath(
  new URL('../scripts/read-job-cancel-in-progress.sh', import.meta.url)
);

function listWorkflowJobs(source) {
  const jobsStart = source.indexOf('\njobs:\n');
  const jobsBody = jobsStart === -1 ? '' : source.slice(jobsStart);

  return Array.from(
    jobsBody.matchAll(/^[ ]{2}([a-zA-Z0-9_-]+):\s*$/gm),
    (match) => match[1]
  );
}

function getJobBlock(source, jobName) {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line === `  ${jobName}:`);

  if (start === -1) {
    return '';
  }

  const end = lines.findIndex(
    (line, index) => index > start && /^[ ]{2}[a-zA-Z0-9_-]+:\s*$/.test(line)
  );

  return lines.slice(start, end === -1 ? lines.length : end).join('\n');
}

function listNeededJobs(jobBlock) {
  const lines = jobBlock.split('\n');
  const needsStart = lines.findIndex((line) => line === '    needs:');

  if (needsStart === -1) {
    return [];
  }

  const neededJobs = [];

  for (const line of lines.slice(needsStart + 1)) {
    const item = line.match(/^[ ]{6}- ([a-zA-Z0-9_-]+)\s*$/);

    if (!item) {
      break;
    }

    neededJobs.push(item[1]);
  }

  return neededJobs;
}

// The gate lists the run's jobs when it has a token and a run ID, which the
// test environment may have on a hosted runner; the tests never call the API.
const API_ENV = ['GH_TOKEN', 'GITHUB_TOKEN', 'GITHUB_RUN_ID', 'JOBS_JSON'];

function runGate(needs, extraEnv = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !API_ENV.includes(name))
  );
  return spawnSync('bash', [scriptPath], {
    encoding: 'utf8',
    env: {
      ...env,
      NEEDS_JSON: JSON.stringify(needs),
      ...extraEnv,
    },
  });
}

const unacquiredJobs = JSON.stringify({
  total_count: 3,
  jobs: [
    {
      name: 'lint',
      conclusion: 'success',
      runner_name: 'GitHub Actions 2',
      steps: [{}],
    },
    {
      name: 'test (macos-15, node)',
      conclusion: 'cancelled',
      runner_name: '',
      steps: [],
    },
    {
      name: 'test (macos-15, bun)',
      conclusion: 'failure',
      runner_name: null,
      steps: [],
    },
  ],
});

describe('pipeline status gate', () => {
  itUnless(sandboxed, noPosixShell)(
    'compares fork PR cancellations with the base repository pull head ref',
    () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'gate-fork-'));
      const git = (...args) =>
        spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
      try {
        git('init', '-q', '-b', 'main');
        git(
          '-c',
          'user.name=test',
          '-c',
          'user.email=test@example.invalid',
          'commit',
          '-qm',
          'base',
          '--allow-empty'
        );
        const base = git('rev-parse', 'HEAD').stdout.trim();
        git(
          '-c',
          'user.name=test',
          '-c',
          'user.email=test@example.invalid',
          'commit',
          '-qm',
          'fork',
          '--allow-empty'
        );
        const fork = git('rev-parse', 'HEAD').stdout.trim();
        git('update-ref', 'refs/pull/7/head', fork);
        git('update-ref', 'refs/heads/main', base);
        const context = {
          RUN_SHA: fork,
          HEAD_REF: 'refs/pull/7/head',
          BRANCH_NAME: 'main',
          GIT_REMOTE: dir,
          WORKFLOW_FILE: '.github/workflows/security.yml',
          BRANCH_HEAD_SHA: '',
        };
        const current = runGate({ codeql: { result: 'cancelled' } }, context);
        expect(current.status).toBe(1);
        git('update-ref', 'refs/pull/7/head', base);
        const superseded = runGate(
          { codeql: { result: 'cancelled' } },
          context
        );
        expect(superseded.status).toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );
  it('stays compatible with the Bash 3.2 shipped by macOS runners', () => {
    const script = readFileSync(scriptPath, 'utf8');

    expect(script).not.toMatch(/\blocal\s+-A\b|\bdeclare\s+-A\b/);
  });

  it('observes every other release workflow job', () => {
    const jobs = listWorkflowJobs(workflow);
    const gate = getJobBlock(workflow, 'pipeline-status');

    expect(gate).toContain('      !cancelled()');
    expect(gate).toContain('uses: actions/setup-node@v7');
    expect(gate).toContain('NEEDS_JSON: ${{ toJSON(needs) }}');
    expect(gate).toContain(
      'RUN_SHA: ${{ github.event.pull_request.head.sha || github.sha }}'
    );
    expect(gate).toContain(
      "HEAD_REF: ${{ github.event_name == 'pull_request' && format('refs/pull/{0}/head', github.event.number) || github.ref }}"
    );
    expect(listNeededJobs(gate).sort()).toEqual(
      jobs.filter((job) => job !== 'pipeline-status').sort()
    );
  });

  it('does not cancel superseded jobs on main', () => {
    expect(workflow).not.toContain('      cancel-in-progress: true');
    expect(workflow).toContain(
      "      cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}"
    );
  });

  itUnless(sandboxed, noPosixShell)(
    'passes when jobs succeeded or were skipped',
    () => {
      const result = runGate({
        lint: { result: 'success' },
        release: { result: 'skipped' },
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Failed jobs:    <none>');
      expect(result.stdout).toContain('Cancelled jobs: <none>');
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'fails for a failed job on every ref',
    () => {
      const result = runGate({ lint: { result: 'failure' } });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        '::error title=Pipeline failed::Failing jobs: lint'
      );
    }
  );

  itUnless(sandboxed, noPosixShell)('fails for a cancelled job on main', () => {
    const result = runGate({ release: { result: 'cancelled' } });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Pipeline has cancelled jobs::release');
  });

  itUnless(sandboxed, noPosixShell)(
    'fails closed for a cancellation without branch and workflow context',
    () => {
      const result = runGate({ test: { result: 'cancelled' } });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain('Pipeline has cancelled jobs::test');
    }
  );
});

describe('pipeline status gate and runner acquisition', () => {
  itUnless(sandboxed, noPosixShell)(
    'names jobs GitHub never acquired a runner for and stays red',
    () => {
      const result = runGate(
        { test: { result: 'cancelled' } },
        { JOBS_JSON: unacquiredJobs }
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        '::error title=Hosted runner not acquired::test (macos-15, node), test (macos-15, bun). GitHub could not provide a runner, so no code ran.'
      );
      expect(result.stdout).toContain('rerun-unacquired.yml');
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'adds nothing when every failed job ran on a runner',
    () => {
      const result = runGate(
        { lint: { result: 'failure' } },
        {
          JOBS_JSON: JSON.stringify({
            jobs: [
              {
                name: 'lint',
                conclusion: 'failure',
                runner_name: 'r',
                steps: [{}],
              },
            ],
          }),
        }
      );

      expect(result.status).toBe(1);
      expect(result.stdout).not.toContain('Hosted runner not acquired');
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'does not list jobs when every required job succeeded',
    () => {
      const result = runGate(
        { lint: { result: 'success' } },
        { JOBS_JSON: 'not json' }
      );

      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain('Runner acquisition unknown');
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'warns, without hiding the failure, when the jobs cannot be listed',
    () => {
      const result = runGate(
        { lint: { result: 'failure' } },
        { JOBS_JSON: 'not json' }
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        '::warning title=Runner acquisition unknown::'
      );
      expect(result.stdout).toContain('Failing jobs: lint');
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'skips the job listing without a token',
    () => {
      const result = runGate(
        { lint: { result: 'failure' } },
        { GITHUB_RUN_ID: '1' }
      );

      expect(result.status).toBe(1);
      expect(result.stdout).not.toContain('Runner acquisition unknown');
    }
  );
});

describe('pipeline status gate in every workflow', () => {
  it('gates every workflow and observes every other job', () => {
    const problems = [];

    for (const [name, source] of Object.entries(gatedWorkflows)) {
      const jobs = listWorkflowJobs(source);
      const gate = getJobBlock(source, 'pipeline-status');

      if (!jobs.includes('pipeline-status')) {
        problems.push(`${name}: no pipeline-status gate job`);
        continue;
      }

      const covered = listNeededJobs(gate).sort();
      const expected = jobs.filter((job) => job !== 'pipeline-status').sort();

      if (covered.join(',') !== expected.join(',')) {
        problems.push(
          `${name}: gate needs [${covered}] does not cover [${expected}]`
        );
      }

      if (
        !gate.includes(
          'RUN_SHA: ${{ github.event.pull_request.head.sha || github.sha }}'
        )
      ) {
        problems.push(`${name}: gate does not pass the tested head as RUN_SHA`);
      }

      if (
        !gate.includes(
          "HEAD_REF: ${{ github.event_name == 'pull_request' && format('refs/pull/{0}/head', github.event.number) || github.ref }}"
        )
      ) {
        problems.push(`${name}: gate does not pass HEAD_REF`);
      }

      if (!gate.includes('GH_TOKEN: ${{ github.token }}')) {
        problems.push(`${name}: gate cannot list the run's jobs (GH_TOKEN)`);
      }

      if (
        !gate.includes(
          '    permissions:\n      actions: read\n      contents: read\n'
        )
      ) {
        problems.push(`${name}: gate lacks actions: read`);
      }

      if (!gate.includes('run: bash scripts/check-pipeline-status.sh')) {
        problems.push(`${name}: gate does not run the gate script`);
      }
    }

    expect(problems).toEqual([]);
  });

  it('uses a status function, so the gate runs when its needs fail', () => {
    const problems = [];

    for (const [name, source] of Object.entries(gatedWorkflows)) {
      const gate = getJobBlock(source, 'pipeline-status');

      if (!gate.includes('!cancelled()') && !gate.includes('always()')) {
        problems.push(`${name}: gate has no status function in its if`);
      }
    }

    expect(problems).toEqual([]);
  });

  it('bounds the new gate jobs at 5 minutes', () => {
    for (const name of [
      'links.yml',
      'security.yml',
      'workflows.yml',
      'example-app.yml',
    ]) {
      const gate = getJobBlock(gatedWorkflows[name], 'pipeline-status');

      expect(gate).toContain('    timeout-minutes: 5');
    }
  });
});

describe('pipeline status supersede detection', () => {
  const cancelled = { lint: { result: 'cancelled' } };

  itUnless(sandboxed, noPosixShell)(
    'errors when main is at the run commit (a genuine overrun)',
    () => {
      const result = runGate(cancelled, {
        RUN_SHA: 'aaa111',
        BRANCH_HEAD_SHA: 'aaa111',
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain('Pipeline has cancelled jobs::lint');
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'warns only when a moved branch could cancel that exact job',
    () => {
      const result = runGate(
        { 'link-checker': { result: 'cancelled' } },
        {
          RUN_SHA: 'aaa111',
          BRANCH_HEAD_SHA: 'bbb222',
          WORKFLOW_FILE: '.github/workflows/links.yml',
        }
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        'Cancelled jobs in a superseded run::link-checker'
      );
      expect(result.stdout).toContain(
        'This run tests aaa111; main is at bbb222.'
      );
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'does not excuse a non-cancellable job after the branch moves',
    () => {
      const result = runGate(
        { 'docker-publish': { result: 'cancelled' } },
        {
          RUN_SHA: 'aaa111',
          BRANCH_HEAD_SHA: 'bbb222',
          WORKFLOW_FILE: '.github/workflows/release.yml',
        }
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toContain('cancel-in-progress: false');
      expect(result.stdout).toContain(
        'Pipeline has cancelled jobs::docker-publish'
      );
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'fails closed when cancel-in-progress is an expression',
    () => {
      const result = runGate(cancelled, {
        RUN_SHA: 'aaa111',
        BRANCH_HEAD_SHA: 'bbb222',
        WORKFLOW_FILE: '.github/workflows/release.yml',
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain('expression or otherwise unreadable');
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'errors when the branch head cannot be resolved',
    () => {
      const result = runGate(cancelled, {
        RUN_SHA: 'aaa111',
        GIT_REMOTE: 'no-such-remote',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Could not resolve the head of main');
      expect(result.stdout).toContain('Pipeline has cancelled jobs::lint');
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'errors without a network call when RUN_SHA is missing',
    () => {
      const result = runGate(cancelled);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('RUN_SHA is unset');
      expect(result.stdout).toContain('Pipeline has cancelled jobs::lint');
    }
  );
});

describe('effective job cancellation policy reader', () => {
  itUnless(sandboxed, noPosixShell)(
    'distinguishes literal, inherited, absent, missing, and expression values',
    () => {
      const root = mkdtempSync(path.join(tmpdir(), 'cancel-policy-'));
      const workflowPath = path.join(root, 'fixture.yml');
      writeFileSync(
        workflowPath,
        [
          'name: fixture',
          'concurrency:',
          '  group: workflow-group',
          '  cancel-in-progress: true',
          'jobs:',
          '  inherited:',
          '    runs-on: ubuntu-latest',
          '  literal-false:',
          '    concurrency:',
          '      group: false-group',
          '      cancel-in-progress: false',
          '    runs-on: ubuntu-latest',
          '  expression:',
          '    concurrency:',
          '      group: expression-group',
          "      cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}",
          '    runs-on: ubuntu-latest',
        ].join('\n')
      );

      try {
        const result = spawnSync(
          'bash',
          [
            concurrencyReaderPath,
            'inherited',
            'literal-false',
            'expression',
            'missing',
          ],
          {
            encoding: 'utf8',
            env: { ...process.env, WORKFLOW_FILE: workflowPath },
          }
        );

        expect(result.status).toBe(0);
        expect(result.stdout.trim().split('\n')).toEqual([
          'inherited\ttrue',
          'literal-false\tfalse',
          'expression\tunknown',
          'missing\tmissing',
        ]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'reports none when neither job nor workflow declares concurrency',
    () => {
      const root = mkdtempSync(path.join(tmpdir(), 'cancel-policy-'));
      const workflowPath = path.join(root, 'fixture.yml');
      writeFileSync(
        workflowPath,
        [
          'name: fixture',
          'jobs:',
          '  plain:',
          '    runs-on: ubuntu-latest',
        ].join('\n')
      );

      try {
        const result = spawnSync('bash', [concurrencyReaderPath, 'plain'], {
          encoding: 'utf8',
          env: { ...process.env, WORKFLOW_FILE: workflowPath },
        });
        expect(result.status).toBe(0);
        expect(result.stdout.trim()).toBe('plain\tnone');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );
});
