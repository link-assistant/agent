import { describe, it, expect } from 'test-anywhere';
import { readdirSync, readFileSync } from 'node:fs';

const WORKFLOW_DIR = '.github/workflows';

function readWorkflow(fileName) {
  return readFileSync(`${WORKFLOW_DIR}/${fileName}`, 'utf8').replaceAll(
    '\r\n',
    '\n'
  );
}

function listWorkflowFiles() {
  return readdirSync(WORKFLOW_DIR).filter((file) => /\.ya?ml$/.test(file));
}

function getStepBlocks(jobBlock) {
  // Split a job body into step blocks: each starts at `- ` (six-space
  // indent inside `steps:`) and runs until the next step at the same indent.
  const lines = jobBlock.split('\n');
  const starts = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (/^ {6}- /.test(lines[index])) {
      starts.push(index);
    }
  }

  return starts.map((start, position) => {
    const end =
      position + 1 < starts.length ? starts[position + 1] : lines.length;
    return lines.slice(start, end).join('\n');
  });
}

function getJobBlock(workflow, jobName) {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line === `  ${jobName}:`);

  if (start === -1) {
    return '';
  }

  const end = lines.findIndex(
    (line, index) => index > start && /^[ ]{2}[a-zA-Z0-9_-]+:\s*$/.test(line)
  );

  return lines.slice(start, end === -1 ? lines.length : end).join('\n');
}

function listWorkflowJobs(workflow) {
  const jobsStart = workflow.indexOf('\njobs:\n');
  const jobsBody = jobsStart === -1 ? '' : workflow.slice(jobsStart);

  return Array.from(
    jobsBody.matchAll(/^[ ]{2}([a-zA-Z0-9_-]+):\s*$/gm),
    (match) => match[1]
  );
}

function listCheckouts(workflow) {
  const checkouts = [];

  for (const jobName of listWorkflowJobs(workflow)) {
    const jobBlock = getJobBlock(workflow, jobName);

    for (const step of getStepBlocks(jobBlock)) {
      if (!/uses: actions\/checkout@/.test(step)) {
        continue;
      }

      checkouts.push({
        job: jobName,
        persists: /persist-credentials:\s*true/.test(step),
        drops: /persist-credentials:\s*false/.test(step),
      });
    }
  }

  return checkouts;
}

// The only jobs allowed to keep the job token in .git/config are the ones
// whose steps write back to the remote using the checkout's built-in token:
// the version commit pushes. Every other checkout must drop the credential so
// a compromised install script or a workspace upload cannot read it.
const JOBS_THAT_PUSH = new Set(['release', 'instant-release']);

describe('checkout credential persistence (artipacked)', () => {
  it('drops the credential on every checkout in a job that does not push', () => {
    const offenders = [];

    for (const file of listWorkflowFiles()) {
      for (const checkout of listCheckouts(readWorkflow(file))) {
        if (JOBS_THAT_PUSH.has(checkout.job)) {
          continue;
        }
        if (!checkout.drops) {
          offenders.push(`${file}:${checkout.job}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps a credential for every job that pushes, and only those', () => {
    const persisting = [];

    for (const file of listWorkflowFiles()) {
      const label = `${WORKFLOW_DIR}/${file}`;
      for (const checkout of listCheckouts(readWorkflow(file))) {
        if (checkout.persists) {
          persisting.push(`${label}:${checkout.job}`);
        }
        if (!checkout.persists && !checkout.drops) {
          persisting.push(`${label}:${checkout.job} (implicit default)`);
        }
      }
    }

    const expected = [
      '.github/workflows/release.yml:release',
      '.github/workflows/release.yml:instant-release',
    ].sort();

    expect(persisting.sort()).toEqual(expected);
  });
});
