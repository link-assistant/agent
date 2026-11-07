import { describe, it, expect } from 'test-anywhere';
import { readFileSync } from 'node:fs';
import { waitForVersionOnRegistry } from '../scripts/publish-retry.mjs';
import { parseArgs as parseWaitArgs } from '../scripts/wait-for-npm.mjs';

const releaseWorkflow = readWorkflow('.github/workflows/release.yml');
const linksWorkflow = readWorkflow('.github/workflows/links.yml');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

function readWorkflow(filePath) {
  return readFileSync(filePath, 'utf8').replaceAll('\r\n', '\n');
}

function normalizeNewlines(text) {
  return text.replaceAll('\r\n', '\n');
}

function listWorkflowJobs(workflow) {
  const normalizedWorkflow = normalizeNewlines(workflow);
  const jobsStart = normalizedWorkflow.indexOf('\njobs:\n');
  const jobsBody = jobsStart === -1 ? '' : normalizedWorkflow.slice(jobsStart);
  const matches = jobsBody.matchAll(/^[ ]{2}([a-zA-Z0-9_-]+):\s*$/gm);

  return Array.from(matches, (match) => match[1]);
}

function getJobBlock(workflow, jobName) {
  const lines = normalizeNewlines(workflow).split('\n');
  const jobHeader = `  ${jobName}:`;
  const start = lines.findIndex((line) => line === jobHeader);

  if (start === -1) {
    return '';
  }

  const end = lines.findIndex(
    (line, index) => index > start && /^[ ]{2}[a-zA-Z0-9_-]+:\s*$/.test(line)
  );

  return lines.slice(start, end === -1 ? lines.length : end).join('\n');
}

function getTimeoutMinutes(workflow, jobName) {
  const block = getJobBlock(workflow, jobName);
  const timeout = block.match(/^[ ]{4}timeout-minutes:\s*(\d+)\s*$/m);

  return timeout ? Number(timeout[1]) : undefined;
}

function getStepBlock(workflow, stepName) {
  const lines = normalizeNewlines(workflow).split('\n');
  const start = lines.findIndex(
    (line) => line.trim() === `- name: ${stepName}`
  );

  if (start === -1) {
    return '';
  }

  const end = lines.findIndex(
    (line, index) => index > start && /^\s*- (name|uses|run):/.test(line)
  );

  return lines.slice(start, end === -1 ? lines.length : end).join('\n');
}

// A step declares its deadline either by wrapping a command in
// run-with-budget-warning.sh or, for `uses:` steps that cannot be wrapped,
// with a step-level timeout-minutes. Every budget keeps the `if:` condition
// of the step it belongs to: mutually exclusive conditions (a matrix leg,
// say) never share a job clock, so summing them as a sequence would
// manufacture violations no job can incur.
function splitStepBlocks(jobBlock) {
  const lines = jobBlock.split('\n');
  const steps = [];
  let current = null;

  for (const line of lines) {
    if (/^ {6}- /.test(line)) {
      if (current) {
        steps.push(current.join('\n'));
      }
      current = [line];
    } else if (current && /^ {8}/.test(line)) {
      current.push(line);
    } else if (current && line.trim() === '') {
      current.push(line);
    } else if (current) {
      steps.push(current.join('\n'));
      current = null;
    }
  }

  if (current) {
    steps.push(current.join('\n'));
  }

  return steps;
}

function getStepCondition(stepBlock) {
  const lines = stepBlock.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const inline = lines[index].match(/^ {8}if:\s*(.+)$/);

    if (!inline) {
      continue;
    }

    const value = inline[1].trim();

    if (['|', '>', '|-', '>-', '|+', '+'].includes(value)) {
      const continuation = [];

      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        const line = lines[cursor];

        if (line.trim() === '') {
          continue;
        }
        if (!/^ {10}/.test(line)) {
          break;
        }

        continuation.push(line.trim());
      }

      return continuation.join(' ');
    }

    return value;
  }

  return '';
}

function parseEnvBlock(lines, envHeaderRegex, keyRegex) {
  const env = {};
  let inside = false;

  for (const line of lines) {
    if (!inside) {
      inside = envHeaderRegex.test(line);
      continue;
    }
    if (line.trim() === '') {
      continue;
    }

    const key = line.match(keyRegex);

    if (!key) {
      break;
    }

    env[key[1]] = key[2].trim().replace(/^['"]|['"]$/g, '');
  }

  return env;
}

function getStepEnv(stepBlock) {
  return parseEnvBlock(
    stepBlock.split('\n').slice(1),
    /^ {8}env:\s*$/,
    /^ {10}([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/
  );
}

function getJobEnv(jobBlock) {
  const lines = jobBlock.split('\n');
  const stepsIndex = lines.findIndex((line) => line.trim() === 'steps:');

  return parseEnvBlock(
    stepsIndex === -1 ? lines : lines.slice(0, stepsIndex),
    /^ {4}env:\s*$/,
    /^ {6}([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/
  );
}

function getWorkflowEnv(workflow) {
  const lines = normalizeNewlines(workflow).split('\n');
  const jobsIndex = lines.findIndex((line) => line === 'jobs:');

  return parseEnvBlock(
    jobsIndex === -1 ? lines : lines.slice(0, jobsIndex),
    /^env:\s*$/,
    /^ {2}([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/
  );
}

function getStepBudgetSeconds(workflow, jobName) {
  const block = getJobBlock(workflow, jobName);
  const jobEnv = getJobEnv(block);
  const workflowEnv = getWorkflowEnv(workflow);
  const budgets = [];

  for (const stepBlock of splitStepBlocks(block)) {
    const condition = getStepCondition(stepBlock);
    const stepEnv = getStepEnv(stepBlock);

    for (const match of stepBlock.matchAll(
      /run-with-budget-warning\.sh\s+(\S+)\s+"([^"]+)"/g
    )) {
      const raw = match[1];
      let seconds;
      let source;

      if (/^\d+$/.test(raw)) {
        seconds = Number(raw);
      } else {
        const variableName = raw.replace(/^["']|["']$/g, '').replace(/^\$/, '');
        const resolved =
          stepEnv[variableName] ??
          jobEnv[variableName] ??
          workflowEnv[variableName];

        if (resolved !== undefined && /^\d+$/.test(resolved)) {
          seconds = Number(resolved);
        } else {
          seconds = NaN;
          source = `"${variableName}" does not resolve to an integer in the step, job, or workflow env`;
        }
      }

      budgets.push({ label: match[2], seconds, condition, source });
    }

    const stepTimeout = stepBlock.match(/^ {8}timeout-minutes:\s*(\d+)\s*$/m);

    if (stepTimeout) {
      budgets.push({
        label: 'step timeout-minutes',
        seconds: Number(stepTimeout[1]) * 60,
        condition,
      });
    }
  }

  return budgets;
}

// The largest a job can spend is every unconditional budget plus the largest
// single conditional group. Grouping by the condition text is deliberately
// conservative: steps guarded by literally the same expression are summed,
// and steps guarded by distinct expressions are treated as alternatives even
// when the expressions could both be true -- deciding that would need
// expression evaluation, and the per-budget check below still bounds each
// step individually.
function getConcurrentBudgetSeconds(budgets) {
  const groups = new Map();

  for (const budget of budgets) {
    groups.set(
      budget.condition,
      (groups.get(budget.condition) ?? 0) + budget.seconds
    );
  }

  const unconditional = groups.get('') ?? 0;
  const conditional = Array.from(groups.entries())
    .filter(([condition]) => condition !== '')
    .map(([, seconds]) => seconds);

  return (
    unconditional + (conditional.length > 0 ? Math.max(...conditional) : 0)
  );
}

describe('CI timeout policy', () => {
  it('sets timeout-minutes for every release workflow job', () => {
    const expectedTimeouts = {
      'detect-changes': 5,
      'test-compilation': 5,
      'check-file-line-limits': 5,
      'version-check': 5,
      'changeset-check': 10,
      lint: 10,
      test: 15,
      'validate-docs': 5,
      release: 65,
      'instant-release': 65,
      'docker-build': 30,
      'docker-publish-config': 45,
      'docker-publish-build': 30,
      'docker-publish': 30,
      'changeset-pr': 10,
      'pipeline-status': 5,
      'release-preflight': 5,
    };

    expect(listWorkflowJobs(releaseWorkflow).sort()).toEqual(
      Object.keys(expectedTimeouts).sort()
    );

    for (const [jobName, timeout] of Object.entries(expectedTimeouts)) {
      expect(getTimeoutMinutes(releaseWorkflow, jobName)).toBe(timeout);
    }
  });

  it('sets timeout-minutes for every link workflow job', () => {
    expect(listWorkflowJobs(linksWorkflow).sort()).toEqual([
      'link-checker',
      'pipeline-status',
    ]);
    expect(getTimeoutMinutes(linksWorkflow, 'link-checker')).toBe(10);
    expect(getTimeoutMinutes(linksWorkflow, 'pipeline-status')).toBe(5);
  });

  it('parses workflow files checked out with Windows line endings', () => {
    const crlfWorkflow = [
      'name: CRLF fixture',
      '',
      'jobs:',
      '  first-job:',
      '    timeout-minutes: 5',
      '  second-job:',
      '    timeout-minutes: 10',
      '',
    ].join('\r\n');

    expect(listWorkflowJobs(crlfWorkflow)).toEqual(['first-job', 'second-job']);
    expect(getTimeoutMinutes(crlfWorkflow, 'second-job')).toBe(10);
  });

  it('caps individual Node.js and Bun tests at 30 seconds', () => {
    expect(packageJson.scripts.test).toBe(
      'node --test --test-timeout=30000 tests/*.test.js'
    );
    expect(releaseWorkflow).toContain('bun test --timeout 30000');
  });

  it('documents that the Bun flag bounds a test and not the suite', () => {
    const bunStep = getStepBlock(releaseWorkflow, 'Run tests (Bun)');

    expect(bunStep).toContain('per-test bound and does not bound the suite');
  });
});

// `timeout-minutes` on a job is a backstop, never the deadline: GitHub reports
// a job it kills as *cancelled*, not *failed*. Every long step therefore
// declares its own budget, and every budget must expire with room to spare
// before the backstop fires.
const MAX_BUDGET_SHARE_PERCENT = 70;

describe('CI execution budgets', () => {
  it('lets publish and Docker waits complete their default propagation window', async () => {
    let publishWaitSeconds = 0;
    await waitForVersionOnRegistry({
      verify: async () => false,
      sleepFn: async (ms) => {
        publishWaitSeconds += ms / 1000;
      },
      log: () => {},
    });
    const wait = parseWaitArgs([], {});
    const dockerWaitSeconds = (wait.maxAttempts - 1) * wait.sleepSeconds;
    for (const job of ['release', 'instant-release', 'docker-publish-config']) {
      const label =
        job === 'docker-publish-config'
          ? 'Docker npm availability wait'
          : 'npm publish and registry verification';
      const pollingSeconds =
        job === 'docker-publish-config'
          ? dockerWaitSeconds
          : publishWaitSeconds;
      const budget = getStepBudgetSeconds(releaseWorkflow, job).find(
        (entry) => entry.label === label
      );
      // Keep room for requests and publishing outside the sleep-only window.
      expect(budget.seconds).toBeGreaterThan(pollingSeconds + 60);
    }
  });

  it('keeps every declared step budget under the job backstop', () => {
    const jobsWithBudgets = listWorkflowJobs(releaseWorkflow)
      .map((jobName) => ({
        jobName,
        budgets: getStepBudgetSeconds(releaseWorkflow, jobName),
        backstop: getTimeoutMinutes(releaseWorkflow, jobName),
      }))
      .filter((job) => job.budgets.length > 0);

    expect(jobsWithBudgets.map((job) => job.jobName).sort()).toEqual([
      'docker-build',
      'docker-publish-build',
      'docker-publish-config',
      'instant-release',
      'release',
      'test',
    ]);

    const violations = [];

    for (const { jobName, budgets, backstop } of jobsWithBudgets) {
      expect(typeof backstop).toBe('number');

      const allowedSeconds = Math.floor(
        (backstop * 60 * MAX_BUDGET_SHARE_PERCENT) / 100
      );

      for (const budget of budgets) {
        // A budget the parser cannot read is itself a violation: silently
        // skipping it would convert every future syntax change into a gap
        // nobody sees.
        if (!Number.isFinite(budget.seconds)) {
          violations.push(
            `${jobName}: "${budget.label}" declares a budget this check cannot read (${budget.source}); the step is not covered by the invariant`
          );
          continue;
        }

        if (budget.seconds > allowedSeconds) {
          violations.push(
            `${jobName}: "${budget.label}" budget ${budget.seconds}s exceeds ${allowedSeconds}s (${MAX_BUDGET_SHARE_PERCENT}% of the ${backstop}min backstop)`
          );
        }
      }

      const totalSeconds = getConcurrentBudgetSeconds(
        budgets.filter((budget) => Number.isFinite(budget.seconds))
      );

      if (totalSeconds > allowedSeconds) {
        violations.push(
          `${jobName}: budgets total ${totalSeconds}s, exceeding ${allowedSeconds}s (${MAX_BUDGET_SHARE_PERCENT}% of the ${backstop}min backstop)`
        );
      }
    }

    expect(violations).toEqual([]);
  });

  it('warns at the same share of the budget that the invariant allows', () => {
    const budgetScript = readWorkflow('scripts/run-with-budget-warning.sh');

    expect(budgetScript).toContain(
      `BUDGET_WARN_PERCENT:-${MAX_BUDGET_SHARE_PERCENT}`
    );
  });
});

// Fixtures for the grouping rules behind the invariant: exclusive legs,
// unconditional-plus-largest-group totals, env resolution, unreadable
// budgets.
describe('step budget grouping', () => {
  // A single matrix job runs exactly one leg, so legs guarded by distinct
  // `if:` conditions never share a job clock. Raising one leg past its
  // allowance while the others still fit must not be rejected as a sequence.
  it('sums exclusive matrix legs as alternatives, not as a sequence', () => {
    const workflow = [
      'name: Fixture',
      '',
      'jobs:',
      '  test:',
      '    timeout-minutes: 15',
      '    strategy:',
      '      matrix:',
      '        runtime: [node, bun, deno]',
      '    steps:',
      '      - name: Run tests (Node.js)',
      "        if: matrix.runtime == 'node'",
      '        run: bash scripts/run-with-budget-warning.sh 331 "Node.js test suite" npm test',
      '      - name: Run tests (Bun)',
      "        if: matrix.runtime == 'bun'",
      '        run: bash scripts/run-with-budget-warning.sh 200 "Bun test suite" bun test',
      '      - name: Run tests (Deno)',
      "        if: matrix.runtime == 'deno'",
      '        run: bash scripts/run-with-budget-warning.sh 100 "Deno test suite" deno test',
      '',
    ].join('\n');

    const budgets = getStepBudgetSeconds(workflow, 'test');

    expect(budgets.map((budget) => budget.seconds).sort()).toEqual([
      100, 200, 331,
    ]);
    expect(getConcurrentBudgetSeconds(budgets)).toBe(331);
  });

  it('still fails when a single leg exceeds the allowance', () => {
    const workflow = [
      'name: Fixture',
      '',
      'jobs:',
      '  test:',
      '    timeout-minutes: 15',
      '    steps:',
      '      - name: Run tests (Node.js)',
      "        if: matrix.runtime == 'node'",
      '        run: bash scripts/run-with-budget-warning.sh 700 "Node.js test suite" npm test',
      '',
    ].join('\n');

    const budgets = getStepBudgetSeconds(workflow, 'test');

    expect(budgets[0].seconds).toBe(700);
    expect(budgets[0].seconds).toBeGreaterThan(630);
  });

  it('adds unconditional budgets to the largest conditional group', () => {
    const workflow = [
      'name: Fixture',
      '',
      'jobs:',
      '  job:',
      '    timeout-minutes: 15',
      '    steps:',
      '      - name: Install',
      '        run: bash scripts/run-with-budget-warning.sh 240 "install" npm install',
      '      - name: Full leg',
      "        if: matrix.test-suite == 'full'",
      '        run: bash scripts/run-with-budget-warning.sh 1440 "full" npm test',
      '      - name: Spec leg',
      "        if: matrix.test-suite == 'specification'",
      '        run: bash scripts/run-with-budget-warning.sh 660 "spec" npm test',
      '',
    ].join('\n');

    const budgets = getStepBudgetSeconds(workflow, 'job');

    expect(getConcurrentBudgetSeconds(budgets)).toBe(1680);
  });

  it('resolves a "$VAR" budget from the step, job, or workflow env', () => {
    const workflow = [
      'name: Fixture',
      '',
      'env:',
      "  WORKFLOW_BUDGET: '50'",
      '',
      'jobs:',
      '  job:',
      '    timeout-minutes: 15',
      '    env:',
      "      JOB_BUDGET: '60'",
      '    steps:',
      '      - name: Step env wins',
      '        env:',
      "          STEP_BUDGET: '70'",
      '        run: bash scripts/run-with-budget-warning.sh "$STEP_BUDGET" "step" npm test',
      '      - name: Job env resolves',
      '        run: bash scripts/run-with-budget-warning.sh "$JOB_BUDGET" "job" npm test',
      '      - name: Workflow env resolves',
      '        run: bash scripts/run-with-budget-warning.sh "$WORKFLOW_BUDGET" "workflow" npm test',
      '',
    ].join('\n');

    const budgets = getStepBudgetSeconds(workflow, 'job');

    expect(budgets.map((budget) => budget.seconds)).toEqual([70, 60, 50]);
  });

  it('reports a budget it cannot read and never skips one silently', () => {
    const workflow = [
      'name: Fixture',
      '',
      'jobs:',
      '  test:',
      '    timeout-minutes: 15',
      '    steps:',
      '      - name: Run tests',
      '        env:',
      "          DENO_TEST_BUDGET_SECONDS: '900'",
      '        run: bash scripts/run-with-budget-warning.sh "$DENO_TEST_BUDGET_SECONDS" "Deno test suite" deno test',
      '      - name: Unresolvable',
      '        run: bash scripts/run-with-budget-warning.sh "$NOWHERE_BUDGET" "missing var" npm test',
      '',
    ].join('\n');

    const budgets = getStepBudgetSeconds(workflow, 'test');

    expect(budgets[0].seconds).toBe(900);
    expect(Number.isFinite(budgets[1].seconds)).toBe(false);
    expect(budgets[1].source).toContain('"NOWHERE_BUDGET"');
  });
});
