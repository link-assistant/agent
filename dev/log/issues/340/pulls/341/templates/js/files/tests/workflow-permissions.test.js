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

function getRunBlocks(workflow) {
  const lines = workflow.split('\n');
  const blocks = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)run:\s*(?:[|>-]+)?\s*(.*)$/);

    if (!match) {
      continue;
    }

    const indentation = match[1].length;
    const block = [match[2]];

    while (
      index + 1 < lines.length &&
      (lines[index + 1].trim() === '' ||
        lines[index + 1].match(/^\s*/)[0].length > indentation)
    ) {
      block.push(lines[index + 1]);
      index += 1;
    }

    blocks.push(block.join('\n'));
  }

  return blocks;
}

// Returns the top-level `permissions:` block body, or undefined when the
// workflow has none (in which case jobs inherit the repository default,
// which is read/write-all on many organisations).
function getTopLevelPermissions(workflow) {
  const lines = workflow.split('\n');
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

describe('workflow token permissions', () => {
  it('declares a top-level permissions block in every workflow', () => {
    const missing = listWorkflowFiles().filter(
      (file) => getTopLevelPermissions(readWorkflow(file)) === undefined
    );

    expect(missing).toEqual([]);
  });

  it('defaults every workflow to read-only repository contents', () => {
    for (const file of listWorkflowFiles()) {
      expect(getTopLevelPermissions(readWorkflow(file))).toBe(
        '  contents: read'
      );
    }
  });

  it('keeps built-in-token write escalation on the publishing jobs only', () => {
    const workflow = readWorkflow('release.yml');
    const jobsBody = workflow.slice(workflow.indexOf('\njobs:\n'));

    for (const job of ['release', 'instant-release']) {
      const start = jobsBody.indexOf(`\n  ${job}:\n`);
      expect(start).not.toBe(-1);

      const rest = jobsBody.slice(start + 1);
      const end = rest.search(/\n {2}[a-zA-Z0-9_-]+:\n/);
      const block = end === -1 ? rest : rest.slice(0, end);

      expect(block.includes('      contents: write')).toBe(true);
    }

    const changesetStart = jobsBody.indexOf('\n  changeset-pr:\n');
    const changesetRest = jobsBody.slice(changesetStart + 1);
    const changesetEnd = changesetRest.search(/\n {2}[a-zA-Z0-9_-]+:\n/);
    const changesetBlock = changesetRest.slice(0, changesetEnd);
    expect(changesetBlock).toContain('      contents: read');
    expect(changesetBlock).not.toContain('      contents: write');
  });
});

describe('workflow command injection policy', () => {
  it('never interpolates contributor-controlled inputs directly into run scripts', () => {
    const unsafeExpression =
      /\$\{\{\s*(?:inputs\.|github\.event\.inputs\.|github\.head_ref)[^}]*\}\}/;
    const violations = [];

    for (const file of listWorkflowFiles()) {
      getRunBlocks(readWorkflow(file)).forEach((runBlock, index) => {
        if (unsafeExpression.test(runBlock)) {
          violations.push(`${file}:run-block-${index + 1}`);
        }
      });
    }

    expect(violations).toEqual([]);
  });
});
