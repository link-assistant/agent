import { describe, it, expect } from 'test-anywhere';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { itUnless, sandboxed } from './helpers/skip.js';

const scriptPath = fileURLToPath(
  new URL('../scripts/check-status-gate-covers-all-jobs.mjs', import.meta.url)
);
const releaseWorkflow = readFileSync(
  '.github/workflows/release.yml',
  'utf8'
).replaceAll('\r\n', '\n');

function runChecker(args, cwd) {
  return spawnSync('node', [scriptPath, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

function writeWorkflow(dir, name, lines) {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, lines.join('\n'));
  return filePath;
}

describe('check-status-gate-covers-all-jobs.mjs', () => {
  itUnless(sandboxed)('accepts comments and blank lines in block needs', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gate-comments-'));
    try {
      const source = releaseWorkflow.replace(
        '      - lint',
        '      # Quality checks\n\n      - lint # includes formatting\n'
      );
      const file = writeWorkflow(dir, 'comments.yml', source.split('\n'));
      const result = runChecker([file]);
      expect(result.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  itUnless(sandboxed)(
    'confirms the shipped release workflow is fully covered',
    () => {
      const result = runChecker(['.github/workflows/release.yml']);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        '.github/workflows/release.yml: pipeline-status covers all 16 other job(s).'
      );
    }
  );

  itUnless(sandboxed)(
    'names the uncovered job when a job is dropped from needs',
    () => {
      const holed = releaseWorkflow
        .split('\n')
        .filter((line) => line !== '      - validate-docs')
        .join('\n');
      const dir = mkdtempSync(path.join(tmpdir(), 'gate-coverage-'));
      const filePath = writeWorkflow(dir, 'holed.yml', holed.split('\n'));

      try {
        const result = runChecker([filePath]);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain(
          `job 'validate-docs' is not in pipeline-status.needs; its failure cannot fail the run`
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );

  itUnless(sandboxed)(
    'exits 2 when the workflow has no terminal status gate at all',
    () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'gate-coverage-'));
      const filePath = writeWorkflow(dir, 'gateless.yml', [
        'name: Gateless',
        '',
        'on: push',
        '',
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: "true"',
        '',
      ]);

      try {
        const result = runChecker([filePath]);

        expect(result.status).toBe(2);
        expect(result.stderr).toContain(
          "no 'pipeline-status' job: this workflow has no terminal status gate"
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );

  itUnless(sandboxed)('accepts a differently named gate via --gate', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gate-coverage-'));
    const filePath = writeWorkflow(dir, 'named.yml', [
      'name: Named gate',
      '',
      'on: push',
      '',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: "true"',
      '  result:',
      '    if: always()',
      '    needs: [build]',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: "true"',
      '',
    ]);

    try {
      const result = runChecker(['--gate', 'result', filePath]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('result covers all 1 other job(s).');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  itUnless(sandboxed)('parses the flow form of needs', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gate-coverage-'));
    const filePath = writeWorkflow(dir, 'flow.yml', [
      'name: Flow needs',
      '',
      'on: push',
      '',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: "true"',
      '  pipeline-status:',
      '    if: always()',
      '    needs: [build]',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: "true"',
      '',
    ]);

    try {
      const result = runChecker([filePath]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        'pipeline-status covers all 1 other job(s).'
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('wires the checker into the workflows meta-workflow for every workflow', () => {
    const workflow = readFileSync('.github/workflows/workflows.yml', 'utf8');

    expect(workflow).toContain('check-status-gate-covers-all-jobs.mjs');

    for (const name of [
      'release.yml',
      'links.yml',
      'security.yml',
      'workflows.yml',
      'example-app.yml',
    ]) {
      expect(workflow).toContain(`.github/workflows/${name}`);
    }
  });
});

describe('check-status-gate-covers-all-jobs.mjs shipped coverage', () => {
  itUnless(sandboxed)(
    'confirms every other shipped workflow is fully covered',
    () => {
      const expectedJobs = {
        'links.yml': 'covers all 1 other job(s).',
        'security.yml': 'covers all 4 other job(s).',
        'workflows.yml': 'covers all 5 other job(s).',
        'example-app.yml': 'covers all 7 other job(s).',
      };

      for (const [name, message] of Object.entries(expectedJobs)) {
        const result = runChecker([`.github/workflows/${name}`]);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain(`${name}: pipeline-status ${message}`);
      }
    }
  );
});
