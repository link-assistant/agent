import { describe, test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyJobs } from '../../scripts/job-cancel-policy.mjs';

/**
 * Policy checks for the GitHub Actions workflows.
 *
 * These are executable versions of the rules in
 * https://github.com/link-assistant/hive-mind/blob/main/docs/CI-CD-BEST-PRACTICES.md
 * and docs/BEST-PRACTICES.md of the pipeline templates
 * (link-foundation/js-ai-driven-development-pipeline-template, which enforces
 * the same rules in tests/workflow-permissions.test.js and
 * tests/ci-timeouts.test.js).
 *
 * Each rule below failed on at least one workflow of this repository when the
 * test was written; see https://github.com/link-assistant/agent/issues/287.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflowDir = join(repoRoot, '.github', 'workflows');

const workflowFiles = readdirSync(workflowDir)
  .filter((file) => /\.ya?ml$/.test(file))
  .sort();

function readWorkflow(file) {
  return readFileSync(join(workflowDir, file), 'utf8').replaceAll('\r\n', '\n');
}

const workflows = workflowFiles.map((file) => ({
  file,
  body: readWorkflow(file),
}));

/**
 * List the top-level job ids of a workflow.
 * @param {string} body
 * @returns {string[]}
 */
export function listJobs(body) {
  const jobsStart = body.indexOf('\njobs:\n');
  if (jobsStart === -1) {
    return [];
  }
  return Array.from(
    body.slice(jobsStart).matchAll(/^ {2}([a-zA-Z0-9_-]+):\s*$/gm),
    (match) => match[1]
  );
}

/**
 * Extract the YAML block belonging to a single job.
 * @param {string} body
 * @param {string} jobId
 * @returns {string}
 */
export function getJobBlock(body, jobId) {
  const lines = body.split('\n');
  const start = lines.indexOf(`  ${jobId}:`);
  if (start === -1) {
    return '';
  }
  const end = lines.findIndex(
    (line, index) => index > start && /^ {2}[a-zA-Z0-9_-]+:\s*$/.test(line)
  );
  return lines.slice(start, end === -1 ? lines.length : end).join('\n');
}

/**
 * Read the `concurrency:` block of a single job.
 * @param {string} body
 * @param {string} jobId
 * @returns {{group: string, cancelInProgress: string|undefined}|undefined}
 */
export function getJobConcurrency(body, jobId) {
  const block = getJobBlock(body, jobId);
  const group = block.match(/^ {6}group: (.+)$/m);
  if (!group) {
    return undefined;
  }
  const cancel = block.match(/^ {6}cancel-in-progress: (.+)$/m);
  return {
    group: group[1].trim(),
    cancelInProgress: cancel?.[1].trim(),
  };
}

/**
 * A workflow is protected against overlapping runs when it declares one group
 * for the whole run, or one group for every job it defines.
 * @param {string} body
 * @returns {boolean}
 */
export function declaresConcurrency(body) {
  if (/^concurrency:\s*$/m.test(body)) {
    return true;
  }
  const jobs = listJobs(body);
  return (
    jobs.length > 0 &&
    jobs.every((jobId) => getJobConcurrency(body, jobId) !== undefined)
  );
}

/**
 * Read the `permissions:` block declared at the workflow level.
 * Without one, jobs inherit the repository default, which is often
 * read/write-all for the whole GITHUB_TOKEN.
 * @param {string} body
 * @returns {string|undefined}
 */
export function getTopLevelPermissions(body) {
  const lines = body.split('\n');
  const start = lines.indexOf('permissions:');
  if (start === -1) {
    return undefined;
  }
  const end = lines.findIndex(
    (line, index) => index > start && line !== '' && !line.startsWith('  ')
  );
  return lines
    .slice(start + 1, end === -1 ? lines.length : end)
    .filter((line) => line.trim() !== '')
    .join('\n');
}

/**
 * List the jobs a job `needs`, in the flow (`needs: [a, b]`), scalar
 * (`needs: a`) or block form. Comments and blank lines inside the block form
 * do not end the list.
 * @param {string} jobBlock
 * @returns {string[]}
 */
export function listNeededJobs(jobBlock) {
  const lines = jobBlock.split('\n');
  const start = lines.findIndex((line) => /^ {4}needs:/.test(line));
  if (start === -1) {
    return [];
  }
  const inline = lines[start].replace(/^ {4}needs:/, '').replace(/#.*$/, '');
  if (inline.trim()) {
    return inline
      .replace(/[[\]]/g, '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
  }
  const needs = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || /^\s*#/.test(line)) {
      continue;
    }
    const item = line.match(/^ {6}- ([a-zA-Z0-9_-]+)\s*(#.*)?$/);
    if (!item) {
      break;
    }
    needs.push(item[1]);
  }
  return needs;
}

/**
 * Collect every `run:` script body of a workflow, both the inline and the
 * block form.
 * @param {string} body
 * @returns {string[]}
 */
export function listRunScripts(body) {
  const lines = body.split('\n');
  const scripts = [];

  for (let index = 0; index < lines.length; index++) {
    const match =
      lines[index].match(/^(\s*)- ?run: ?(.*)$/) ||
      lines[index].match(/^(\s*)run: ?(.*)$/);
    if (!match) {
      continue;
    }

    const indent = match[1].length;
    const inline = match[2].trim();

    if (
      inline !== '|' &&
      inline !== '>' &&
      inline !== '|-' &&
      inline !== '>-'
    ) {
      scripts.push(inline);
      continue;
    }

    const blockLines = [];
    for (let next = index + 1; next < lines.length; next++) {
      const line = lines[next];
      if (line.trim() !== '' && line.search(/\S/) <= indent) {
        break;
      }
      blockLines.push(line);
    }
    scripts.push(blockLines.join('\n'));
  }

  return scripts;
}

describe('workflow token permissions', () => {
  test('every workflow declares a top-level permissions block', () => {
    const missing = workflows
      .filter(({ body }) => getTopLevelPermissions(body) === undefined)
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  test('the default is read-only repository contents', () => {
    for (const { file, body } of workflows) {
      expect([file, getTopLevelPermissions(body)]).toEqual([
        file,
        '  contents: read',
      ]);
    }
  });
});

describe('CI timeout policy', () => {
  test('every job declares timeout-minutes', () => {
    const missing = [];

    for (const { file, body } of workflows) {
      for (const jobId of listJobs(body)) {
        if (
          !/^ {4}timeout-minutes:\s*\d+\s*$/m.test(getJobBlock(body, jobId))
        ) {
          missing.push(`${file}:${jobId}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  test('every workflow defines at least one job', () => {
    for (const { file, body } of workflows) {
      expect([file, listJobs(body).length > 0]).toEqual([file, true]);
    }
  });
});

describe('cancellation propagation', () => {
  /**
   * The status aggregation job is the one job that must observe a cancelled
   * run: it exists to report cancellations, so `!cancelled()` would skip it
   * exactly when it is needed. It runs no build steps of its own.
   */
  const ALWAYS_ALLOWED_JOBS = new Set(['pipeline-status']);

  // always() still evaluates to true for a cancelled run, so dependent jobs
  // keep running after a cancel. !cancelled() stops the chain.
  // See hive-mind issue #1278.
  test('job conditions use !cancelled() instead of always()', () => {
    const offenders = [];

    for (const { file, body } of workflows) {
      for (const jobId of listJobs(body)) {
        if (ALWAYS_ALLOWED_JOBS.has(jobId)) {
          continue;
        }
        const block = getJobBlock(body, jobId);
        const condition = block.match(/^ {4}if:(.*)$/m)?.[1] ?? '';
        if (condition.includes('always()')) {
          offenders.push(`${file}:${jobId}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  // The exemption above is only safe while that job stays a pure observer.
  test('the status aggregation job only reports the result', () => {
    for (const { file, body } of workflows) {
      if (!listJobs(body).includes('pipeline-status')) {
        continue;
      }
      const block = getJobBlock(body, 'pipeline-status');
      const scripts = listRunScripts(block);
      expect([file, scripts]).toEqual([
        file,
        ['bash scripts/check-pipeline-status.sh'],
      ]);
    }
  });
});

describe('workflow_dispatch input handling', () => {
  // A `${{ inputs.x }}` expression is substituted into the shell script before
  // it runs, so a value containing shell metacharacters is executed as code.
  // Passing the value through env: keeps it as data.
  test('run scripts never interpolate workflow inputs directly', () => {
    const offenders = [];

    for (const { file, body } of workflows) {
      for (const script of listRunScripts(body)) {
        const match = script.match(
          /\$\{\{\s*(?:inputs\.|github\.event\.inputs\.|github\.head_ref)[^}]*\}\}/
        );
        if (match) {
          offenders.push(`${file}: ${match[0]}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('per-test timeouts', () => {
  // Without a per-test cap a hung test burns the whole job timeout before
  // reporting anything.
  test('the bun unit test script sets a global test timeout', () => {
    const packageJson = JSON.parse(
      readFileSync(join(repoRoot, 'js', 'package.json'), 'utf8')
    );

    expect(packageJson.scripts.test).toContain('--timeout ');
  });
});

describe('merge result validation', () => {
  // GitHub builds refs/pull/N/merge when the pull request is synchronized, so
  // commits pushed to the base branch afterwards are not part of what CI
  // checked: a pull request can be green while its merge result is broken.
  test('the lint job of each pipeline simulates a fresh merge', () => {
    const missing = ['js.yml', 'rust.yml'].filter((file) => {
      const body = workflows.find((workflow) => workflow.file === file)?.body;
      return !getJobBlock(body ?? '', 'lint').includes(
        'scripts/simulate-fresh-merge.sh'
      );
    });

    expect(missing).toEqual([]);
  });
});

describe('pipeline status gate', () => {
  // A job left out of the gate's `needs` can time out or fail while the gate
  // reports success, and a workflow without a gate turns grey instead of red
  // when timeout-minutes cancels its only job (#337).
  test('every workflow has a pipeline-status gate that needs every other job', () => {
    for (const { file, body } of workflows) {
      const jobs = listJobs(body);
      const gate = getJobBlock(body, 'pipeline-status');
      expect([file, gate !== '']).toEqual([file, true]);
      expect([file, gate.match(/^ {4}if:(.*)$/m)?.[1].trim()]).toEqual([
        file,
        'always()',
      ]);
      expect([file, listNeededJobs(gate).sort()]).toEqual([
        file,
        jobs.filter((job) => job !== 'pipeline-status').sort(),
      ]);
    }
  });

  // The gate excuses a cancellation only when it can tell that a newer run
  // may cancel the job; an unreadable value fails superseded runs closed.
  test('every job has a cancel-in-progress value the gate can evaluate', () => {
    const unreadable = [];
    for (const { file, body } of workflows) {
      for (const { job, value, cancellable } of classifyJobs(
        body,
        listJobs(body),
        'refs/pull/1/merge'
      )) {
        if (cancellable === null) {
          unreadable.push(`${file}:${job}: ${value}`);
        }
      }
    }
    expect(unreadable).toEqual([]);
  });

  test('the needs parser reads every form', () => {
    expect(listNeededJobs('  a:\n    needs: [lint, test]\n')).toEqual([
      'lint',
      'test',
    ]);
    expect(listNeededJobs('  a:\n    needs: lint\n')).toEqual(['lint']);
    expect(
      listNeededJobs(
        '  a:\n    needs:\n      - lint\n\n      # tests\n      - test\n    steps: []\n'
      )
    ).toEqual(['lint', 'test']);
  });
});

describe('release gating', () => {
  // instant-release had no `needs` at all, so a manual release published while
  // lint or the tests were failing (#337).
  const PUBLISHERS = {
    'js.yml': ['release', 'instant-release'],
    'rust.yml': ['auto-release', 'manual-release'],
  };

  for (const [file, jobs] of Object.entries(PUBLISHERS)) {
    for (const job of jobs) {
      test(`${file}:${job} requires lint and test to succeed`, () => {
        const block = getJobBlock(
          workflows.find((workflow) => workflow.file === file).body,
          job
        );
        const condition = block.match(/^ {4}if:(.*)$/m)?.[1] ?? '';
        expect(listNeededJobs(block)).toEqual(
          expect.arrayContaining(['lint', 'test'])
        );
        expect(condition).toContain("needs.lint.result == 'success'");
        expect(condition).toContain("needs.test.result == 'success'");
        expect(condition).toContain('!cancelled()');
      });
    }
  }
});

describe('release tooling', () => {
  // `changeset version` formats files with the package manager it detects
  // (bun, because of js/bun.lock). Without bun the 0.26.15 release left its
  // changeset in js/.changeset.
  test('the release job installs bun before running changeset version', () => {
    const body = workflows.find((workflow) => workflow.file === 'js.yml').body;
    const release = getJobBlock(body, 'release');
    const bun = release.indexOf('oven-sh/setup-bun@');

    expect(bun).toBeGreaterThan(-1);
    expect(bun).toBeLessThan(release.indexOf('version-and-commit.mjs'));
  });
});

describe('secrets detection', () => {
  test('the js pipeline scans the repository for committed secrets', () => {
    const body = workflows.find((workflow) => workflow.file === 'js.yml').body;

    expect(getJobBlock(body, 'lint')).toContain('secretlint');
  });
});

describe('checkout hygiene', () => {
  // actions/checkout runs `git init` before any config exists, so every job
  // printed "hint: Using 'master' as the name for the initial branch" into the
  // log. Observed in run 30657021842.
  test('every workflow silences the git default-branch hint', () => {
    const missing = workflows
      .filter(
        ({ body }) => !body.includes('GIT_CONFIG_KEY_0: init.defaultBranch')
      )
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

describe('action pinning', () => {
  // A floating ref (@main, @master, a branch name) means a third party can
  // change what runs in this repository's CI without a commit here.
  test('every external action is pinned to a version tag or a commit', () => {
    const offenders = [];

    for (const { file, body } of workflows) {
      for (const [, ref] of body.matchAll(/^\s*uses: (\S+)\s*$/gm)) {
        if (ref.startsWith('./')) {
          continue; // A local action lives in this repository.
        }
        const version = ref.split('@')[1];
        if (
          version === undefined ||
          /^(main|master|latest|develop)$/.test(version)
        ) {
          offenders.push(`${file}: ${ref}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('concurrency control', () => {
  // Principle 10 of the best-practices document allows two shapes: one group
  // for the whole workflow, or one group per job. A check-only workflow uses
  // the per-job shape so an unrelated check is not cancelled together with the
  // stale one, so requiring the workflow-level block alone reported a
  // correctly configured workflow as unprotected.
  test('every workflow declares a concurrency group', () => {
    const missing = workflows
      .filter(({ body }) => !declaresConcurrency(body))
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  // A push to main starts a release. `cancel-in-progress: true` at the
  // workflow level lets the next push cancel it mid-publish, leaving a version
  // bumped and tagged but never published. Only non-main runs may be cancelled.
  test('workflows triggered by push to main never cancel main runs', () => {
    const offenders = workflows
      .filter(({ body }) => /^ {6}- main\s*$/m.test(body))
      .filter(({ body }) => /^ {2}cancel-in-progress: true\s*$/m.test(body))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  // The same trap one level down: a job-level `cancel-in-progress: true` on a
  // writer is invisible to the test above. Only a read-only check job, which
  // the templates name with a `check-` group prefix, may be cancelled.
  test('only check groups cancel jobs in progress', () => {
    const offenders = [];

    for (const { file, body } of workflows) {
      for (const jobId of listJobs(body)) {
        const concurrency = getJobConcurrency(body, jobId);
        if (
          concurrency?.cancelInProgress === 'true' &&
          !concurrency.group.startsWith('check-')
        ) {
          offenders.push(`${file}: ${jobId}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
