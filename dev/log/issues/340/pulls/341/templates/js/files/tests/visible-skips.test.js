import { describe, it, expect } from 'test-anywhere';
import { readdirSync, readFileSync } from 'node:fs';
import { findConditionalRegistrations } from './helpers/conditional-registration.js';
import { itUnless, missingDenoPermissions } from './helpers/skip.js';
import { blankEnv } from './helpers/env.js';

const lines = (...rows) => rows.join('\n');

describe('findConditionalRegistrations', () => {
  it('flags swapped registrars and skipped suites', () => {
    const source = lines(
      'const suite = canRun ? ' + 'describe : () => {};',
      'const suite = canRun ? () => {} : ' + 'describe;',
      'describe' + ".skip('fixture', () => {});"
    );
    expect(
      findConditionalRegistrations(source).map((finding) => finding.kind)
    ).toEqual(['swapped', 'swapped', 'swapped']);
  });

  it('flags tests registered inside an if block', () => {
    const source = lines(
      "describe('x', () => {",
      '  if (canRunBash) {',
      "    it('runs', () => {});",
      '  }',
      '});'
    );

    expect(findConditionalRegistrations(source)).toEqual([
      { line: 2, kind: 'wrapped', text: 'if (canRunBash) {' },
    ]);
  });

  it('flags a describe callback that returns before registering', () => {
    const source = lines(
      "describe('x', () => {",
      '  // Deno cannot spawn here.',
      "  if (typeof Deno !== 'undefined') {",
      '    return; // nothing below runs',
      '  }',
      "  it('runs', () => {});",
      '});'
    );

    expect(findConditionalRegistrations(source).map((f) => f.kind)).toEqual([
      'early-return',
    ]);
  });

  it('flags a test body that passes early on an environment check', () => {
    const source = lines(
      "it('spawns', () => {",
      '  if (readOnlyRuntime()) {',
      '    return;',
      '  }',
      '  expect(run()).toBe(0);',
      '});',
      "it('lists', () => {",
      "  if (process.platform === 'win32') return;",
      '});'
    );

    expect(findConditionalRegistrations(source).map((f) => f.line)).toEqual([
      2, 8,
    ]);
  });

  it('leaves early returns on data and helper functions alone', () => {
    const source = lines(
      'function parse(text) {',
      "  if (typeof Deno !== 'undefined') {",
      '    return;',
      '  }',
      '}',
      "it('reads', () => {",
      '  if (!match) {',
      '    return;',
      '  }',
      '});'
    );

    expect(findConditionalRegistrations(source)).toEqual([]);
  });
});

describe('test registration', () => {
  const files = readdirSync('tests').filter((file) =>
    file.endsWith('.test.js')
  );

  for (const file of files) {
    it(`${file} registers every test unconditionally`, () => {
      const findings = findConditionalRegistrations(
        readFileSync(`tests/${file}`, 'utf8')
      ).map((finding) => `${file}:${finding.line} ${finding.kind}`);

      expect(findings).toEqual([]);
    });

    it(`${file} passes blank environment values to child fixtures`, () => {
      expect(readFileSync(`tests/${file}`, 'utf8')).not.toMatch(
        /\bdelete\s+\w*env\w*(?:\.\w+|\[[^\]]+\])/i
      );
    });

    // Deno's --parallel workers share one process working directory.
    it(`${file} leaves the process working directory alone`, () => {
      expect(readFileSync(`tests/${file}`, 'utf8')).not.toMatch(
        /\b(?:process|Deno)\.chdir\(/
      );
    });
  }
});

describe('test file discovery', () => {
  // Every runner uses tests/. Maintained tests belong there; immutable
  // archives and generated output may retain their original filenames.
  const BUN_TEST_NAME = /[._](?:test|spec)\.[cm]?[jt]sx?$/;
  const SKIPPED_DIRS = new Set([
    '.git',
    'node_modules',
    'tests',
    'dist',
    'out',
    'reports',
  ]);

  function testNamedFiles(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const entryPath = dir === '.' ? entry.name : `${dir}/${entry.name}`;
      if (
        entryPath === 'dev/log' ||
        /^docs\/case-studies\/[^/]+\/data$/.test(entryPath)
      ) {
        return [];
      }
      if (entry.isDirectory()) {
        return SKIPPED_DIRS.has(entry.name) ? [] : testNamedFiles(entryPath);
      }
      return BUN_TEST_NAME.test(entry.name) ? [entryPath] : [];
    });
  }

  it('keeps test-named files inside tests/, so every runner runs the same set', () => {
    expect(testNamedFiles('.')).toEqual([]);
  });
});

describe('Deno CI leg', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8');

  it('grants the permissions required by fixture tests', () => {
    // A Windows checkout ends lines with CRLF.
    expect(workflow).toMatch(/"Deno test suite" deno test -A --parallel\r?\n/);
  });
});

describe('skip helpers', () => {
  const fakeDeno = (granted) => ({
    permissions: {
      querySync: ({ name }) => ({
        state: granted.includes(name) ? 'granted' : 'prompt',
      }),
    },
  });

  it('lists the Deno permissions a run lacks', () => {
    expect(missingDenoPermissions(fakeDeno(['read', 'env']))).toEqual([
      'write',
      'run',
      'sys',
      'net',
      'ffi',
    ]);
    expect(
      missingDenoPermissions(
        fakeDeno(['read', 'write', 'run', 'env', 'sys', 'net', 'ffi'])
      )
    ).toEqual([]);
    expect(missingDenoPermissions(null)).toEqual([]);
  });

  it('returns the plain registrar when no reason applies', () => {
    expect(itUnless(null, false, undefined)).toBe(it);
  });

  it('returns a skipping registrar when a reason applies', () => {
    expect(itUnless(null, 'no shell')).not.toBe(it);
  });
});

describe('fixture environment isolation', () => {
  it('blanks selected values and preserves the parent environment', () => {
    const parent = { CI: 'true', GITHUB_BASE_SHA: 'runner-sha', PATH: '/bin' };
    expect(blankEnv(parent, (name) => /^(CI$|GITHUB_)/.test(name))).toEqual({
      CI: '',
      GITHUB_BASE_SHA: '',
      PATH: '/bin',
    });
    expect(parent).toEqual({
      CI: 'true',
      GITHUB_BASE_SHA: 'runner-sha',
      PATH: '/bin',
    });
  });
});
