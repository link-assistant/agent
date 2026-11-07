import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'test-anywhere';
import {
  parseChangedLines,
  filterWarningsToChangedLines,
  lintExitCode,
} from '../scripts/lint-changed-lines.mjs';

const DIFF = [
  'diff --git a/scripts/example.mjs b/scripts/example.mjs',
  '--- a/scripts/example.mjs',
  '+++ b/scripts/example.mjs',
  '@@ -10,0 +11,2 @@',
  '+// this line is new',
  '+const value = 1;',
  '',
].join('\n');

function warning(line) {
  return {
    severity: 1,
    line,
    ruleId: 'local/no-changelog-comments',
    message: 'history',
  };
}

describe('parseChangedLines', () => {
  it('collects added line numbers per file', () => {
    const changed = parseChangedLines(DIFF);

    expect(Array.from(changed.get('scripts/example.mjs'))).toEqual([11, 12]);
  });
});

describe('filterWarningsToChangedLines', () => {
  const cwd = '/repo';
  const changed = parseChangedLines(DIFF);

  it('keeps warnings on changed lines', () => {
    const [result] = filterWarningsToChangedLines(
      [
        {
          filePath: '/repo/scripts/example.mjs',
          messages: [warning(11)],
          errorCount: 0,
          warningCount: 1,
        },
      ],
      changed,
      cwd
    );

    expect(result.messages.length).toBe(1);
    expect(result.warningCount).toBe(1);
  });

  it('drops warnings on unchanged lines of a changed file', () => {
    const [result] = filterWarningsToChangedLines(
      [
        {
          filePath: '/repo/scripts/example.mjs',
          messages: [warning(3)],
          errorCount: 0,
          warningCount: 1,
        },
      ],
      changed,
      cwd
    );

    expect(result.messages.length).toBe(0);
    expect(result.warningCount).toBe(0);
  });

  it('drops warnings from files that were not touched at all', () => {
    const [result] = filterWarningsToChangedLines(
      [
        {
          filePath: '/repo/scripts/other.mjs',
          messages: [warning(1)],
          errorCount: 0,
          warningCount: 1,
        },
      ],
      changed,
      cwd
    );

    expect(result.messages.length).toBe(0);
  });

  it('keeps every warning of a wholly new file', () => {
    const newFileChanges = new Map([['scripts/new.mjs', true]]);
    const [result] = filterWarningsToChangedLines(
      [
        {
          filePath: '/repo/scripts/new.mjs',
          messages: [warning(42)],
          errorCount: 0,
          warningCount: 1,
        },
      ],
      newFileChanges,
      cwd
    );

    expect(result.messages.length).toBe(1);
  });

  it('always keeps errors regardless of the diff', () => {
    const [result] = filterWarningsToChangedLines(
      [
        {
          filePath: '/repo/scripts/other.mjs',
          messages: [{ severity: 2, line: 5, ruleId: 'no-var' }],
          errorCount: 1,
          warningCount: 0,
        },
      ],
      changed,
      cwd
    );

    expect(result.messages.length).toBe(1);
    expect(result.errorCount).toBe(1);
  });
});

describe('lintExitCode', () => {
  const result = (errorCount, warningCount) => ({ errorCount, warningCount });

  it('passes only when nothing is reported', () => {
    expect(lintExitCode([result(0, 0), result(0, 0)])).toBe(0);
    expect(lintExitCode([])).toBe(0);
  });

  it('fails on a reported warning, as the pre-commit hook does', () => {
    expect(lintExitCode([result(0, 0), result(0, 1)])).toBe(1);
  });

  it('fails on an error', () => {
    expect(lintExitCode([result(1, 0)])).toBe(1);
  });

  it('reports every warning on pushes to main', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
    const step = workflow.split('- name: Run ESLint')[1].split('- name:')[0];
    expect(step).toContain(
      "LINT_ALL_WARNINGS: ${{ github.event_name != 'pull_request' && '1' || '0' }}"
    );
    expect(step).toContain('run: npm run lint');
  });
});

describe('eslint.config.js', () => {
  it('imports only packages that package.json declares', () => {
    // ESLint 9 hoisted @eslint/js, so an undeclared import still resolved;
    // ESLint 10 no longer depends on it.
    const config = readFileSync('eslint.config.js', 'utf8');
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const declared = { ...pkg.dependencies, ...pkg.devDependencies };
    const imported = [...config.matchAll(/from '([^.][^']*)'/g)].map(
      ([, spec]) =>
        spec
          .split('/')
          .slice(0, spec.startsWith('@') ? 2 : 1)
          .join('/')
    );

    expect(imported).toContain('@eslint/js');
    for (const name of imported) {
      expect(`${name} ${typeof declared[name]}`).toBe(`${name} string`);
    }
  });
});
