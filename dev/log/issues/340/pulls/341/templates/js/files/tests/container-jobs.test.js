import { describe, expect, it } from 'test-anywhere';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { itUnless, noPosixShell, sandboxed } from './helpers/skip.js';

const WORKFLOWS = '.github/workflows';

function readWorkflow(file) {
  return readFileSync(join(WORKFLOWS, file), 'utf8').replaceAll('\r\n', '\n');
}

function jobBlocks(workflow) {
  const body = workflow.slice(workflow.indexOf('\njobs:\n'));
  return body.split(/\n(?= {2}[\w-]+:\n)/).slice(1);
}

function stepScript(job, name) {
  const step = job.split(`- name: ${name}\n`)[1].split('\n      - ')[0];
  const lines = step.split('run: |\n')[1].split('\n');
  return lines
    .filter((line) => line.startsWith('          ') || line === '')
    .map((line) => line.slice(10))
    .join('\n');
}

const containerJobs = readdirSync(WORKFLOWS)
  .filter((file) => /\.ya?ml$/.test(file))
  .flatMap((file) =>
    jobBlocks(readWorkflow(file))
      .filter((job) => /^ {4}container:/m.test(job))
      .map((job) => ({ file, name: job.split(':')[0].trim(), job }))
  );

describe('container jobs', () => {
  it('include the preview-image job', () => {
    expect(containerJobs.map(({ name }) => name)).toContain('preview-regen');
  });

  it('run scripts with bash and trust the checkout', () => {
    for (const { file, name, job } of containerJobs) {
      const where = `${file} ${name}`;
      expect(`${where}\n${job}`).toMatch(
        /\n {4}defaults:\n {6}run:\n {8}shell: bash\n/
      );
      expect(`${where}\n${job}`).toContain(
        'git config --global --add safe.directory "$GITHUB_WORKSPACE"'
      );
    }
  });
});

describe('preview push authentication', () => {
  const job = containerJobs.find(({ name }) => name === 'preview-regen').job;

  itUnless(sandboxed, noPosixShell)(
    'uses the available push token and records only successfully landed images',
    () => {
      const commit = stepScript(job, 'Commit drift back to main');
      const root = mkdtempSync(join(tmpdir(), 'preview-push-'));
      try {
        const output = join(root, 'output');
        const requests = join(root, 'requests');
        for (const [name, body] of Object.entries({
          gh: 'printf "gh token=%s\\n" "$GH_TOKEN" >> "$REQUESTS"',
          git: `printf 'git %s\\n' "$*" >> "$REQUESTS"
if [[ "$1" == diff ]]; then exit "$NO_CHANGES"; fi
if [[ "$1" == add ]]; then exit "$ADD_STATUS"; fi`,
          node: `printf 'push token=%s\\n' "$GH_TOKEN" >> "$REQUESTS"
exit "$PUSH_STATUS"`,
        })) {
          writeFileSync(join(root, name), `#!/usr/bin/env bash\n${body}\n`, {
            mode: 0o755,
          });
        }
        function run(env = {}) {
          writeFileSync(output, '');
          writeFileSync(requests, '');
          const result = spawnSync('bash', ['-eu', '-c', commit], {
            encoding: 'utf8',
            env: {
              ...process.env,
              PATH: `${root}:${process.env.PATH}`,
              GITHUB_OUTPUT: output,
              REQUESTS: requests,
              RELEASE_PR_TOKEN: '',
              BUILT_IN_TOKEN: 'built-in-fixture-token',
              SECRETS_URL:
                'https://github.com/owner/repo/settings/secrets/actions',
              NO_CHANGES: '1',
              PUSH_STATUS: '0',
              ADD_STATUS: '0',
              ...env,
            },
          });
          return {
            ...result,
            output: readFileSync(output, 'utf8'),
            requests: readFileSync(requests, 'utf8'),
          };
        }
        for (const dedicated of ['', 'dedicated-fixture-token']) {
          const result = run({ RELEASE_PR_TOKEN: dedicated });
          expect(result.status).toBe(0);
          expect(result.output).toBe('landed=true\n');
          expect(result.requests).toContain(
            `push token=${dedicated || 'built-in-fixture-token'}`
          );
          expect(result.requests).toContain(
            'git add -- docs/screenshots/example-app/'
          );
        }
        const denied = run({ PUSH_STATUS: '1' });
        expect(denied.status).toBe(1);
        expect(denied.output).toBe('');
        expect(denied.stdout).toContain(
          'Contents and Pull requests read/write'
        );
        expect(denied.stdout).toContain(
          'https://github.com/owner/repo/settings/secrets/actions'
        );
        const unchanged = run({ NO_CHANGES: '0' });
        expect(unchanged.status).toBe(0);
        expect(unchanged.output).toBe('');
        expect(unchanged.requests).not.toContain('push token=');
        const stagingFailure = run({ ADD_STATUS: '23' });
        expect(stagingFailure.status).toBe(23);
        expect(stagingFailure.output).toBe('');
        expect(stagingFailure.requests).not.toContain('push token=');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );
});

describe('preview drift detection', () => {
  const job = containerJobs.find(({ name }) => name === 'preview-regen').job;
  const script = stepScript(job, 'Detect drift');

  itUnless(sandboxed, noPosixShell)(
    'reports only the preview outcome that actually happened',
    () => {
      const summary = stepScript(job, 'Summarize regeneration result');
      const scenarios = [
        [{ REGENERATE: 'failure' }, 'not regenerated'],
        [
          { REGENERATE: 'success', DRIFT_OUTCOME: 'failure' },
          'could not be checked',
        ],
        [
          { REGENERATE: 'success', DRIFT_OUTCOME: 'success', DRIFT: 'false' },
          'already up to date',
        ],
        [
          {
            REGENERATE: 'success',
            DRIFT_OUTCOME: 'success',
            DRIFT: 'true',
            COMMIT: 'success',
            LANDED: 'true',
          },
          'were committed',
        ],
        [
          {
            REGENERATE: 'success',
            DRIFT_OUTCOME: 'success',
            DRIFT: 'true',
            COMMIT: 'failure',
          },
          'were not committed',
        ],
        [
          {
            REGENERATE: 'success',
            DRIFT_OUTCOME: 'success',
            DRIFT: 'true',
            COMMIT: 'success',
          },
          'were not committed',
        ],
      ];
      for (const [env, message] of scenarios) {
        const result = spawnSync('bash', ['-eu', '-c', summary], {
          encoding: 'utf8',
          env: {
            ...process.env,
            REGENERATE: '',
            DRIFT_OUTCOME: '',
            DRIFT: '',
            COMMIT: '',
            LANDED: '',
            ...env,
          },
        });
        expect(result.status).toBe(0);
        expect(result.stdout).toContain(message);
      }
    }
  );

  function detect(setup) {
    const root = mkdtempSync(join(tmpdir(), 'preview-drift-'));
    const dir = join(root, 'checkout');
    try {
      mkdirSync(dir);
      setup(dir);
      const output = join(root, 'output');
      writeFileSync(output, '');
      const result = spawnSync('bash', ['-e', '-c', script], {
        cwd: dir,
        encoding: 'utf8',
        // Stop git from finding a repository above the fixture.
        env: {
          ...process.env,
          GITHUB_OUTPUT: output,
          GIT_CEILING_DIRECTORIES: root,
        },
      });
      return { ...result, output: readFileSync(output, 'utf8') };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  const git = (dir, ...args) =>
    spawnSync('git', args, { cwd: dir, encoding: 'utf8' });

  itUnless(sandboxed, noPosixShell)(
    'fails when git cannot read the checkout',
    () => {
      // A directory outside any repository fails git status the way the
      // untrusted container checkout did.
      const result = detect(() => {});
      expect(result.status).not.toBe(0);
      expect(result.output).toBe('');
      expect(result.stdout).not.toContain('already current');
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'reports drift in a changed checkout',
    () => {
      const result = detect((dir) => {
        git(dir, 'init', '-q');
        writeFileSync(join(dir, 'preview.png'), 'changed');
      });
      expect(result.status).toBe(0);
      expect(result.output).toBe('drift=true\n');
      expect(result.stdout).toContain('?? preview.png');
    }
  );

  itUnless(sandboxed, noPosixShell)(
    'reports a clean checkout as current',
    () => {
      const result = detect((dir) => {
        git(dir, 'init', '-q');
      });
      expect(result.status).toBe(0);
      expect(result.output).toBe('drift=false\n');
      expect(result.stdout).toContain('Preview images already current.');
    }
  );
});
