// Regression tests for the lychee report parser used by the Broken Link
// Checker workflow. A lychee error without an http(s) URL - a missing local
// file, an unresolvable root-relative link - has no Wayback equivalent. Such
// errors must still be reported, and must keep the check red.
import assert from 'node:assert/strict';
import { describe, it } from 'test-anywhere';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  extractBrokenLinks,
  extractBrokenUrls,
  extractErrorsSection,
} from '../scripts/check-web-archive.mjs';
import { itUnless, sandboxed } from './helpers/skip.js';
import { validateLycheeReport } from '../scripts/lychee-report.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const report = readFileSync(
  join(here, 'fixtures', 'lychee-report.md'),
  'utf-8'
);

describe('lychee summary evidence', () => {
  it('accepts the captured real failed report', () => {
    assert.doesNotThrow(() => validateLycheeReport(report, true, true));
  });
  it('accepts a genuine clean report only when the checker succeeded', () => {
    const clean =
      '# Summary\r\n\r\n| 🚫 Errors | 0 |\r\n| ⛔ Unsupported | 2 |\r\n';
    assert.doesNotThrow(() => validateLycheeReport(clean, false, false));
    assert.throws(() => validateLycheeReport(clean, false, true));
  });
  it('counts transient categories and refuses missing failure details', () => {
    const timeout =
      '# Link Checker Report\n\n| 🚫 Errors | 0 |\n| ⏳ Timeouts | 1 |\n';
    assert.doesNotThrow(() => validateLycheeReport(timeout, true, true));
    assert.throws(() => validateLycheeReport(timeout, false, true));
  });
});

describe('extractErrorsSection', () => {
  it('stops at the next top-level heading', () => {
    const section = extractErrorsSection(report);
    assert.ok(section.includes('Errors in README.md'));
    assert.ok(
      !section.includes('Redirects per input'),
      'the redirects section must not leak into the errors section'
    );
  });

  it('falls back to the whole document when the heading is absent', () => {
    const legacy = '# Link report\n\n* [404] https://broken.example/legacy\n';
    assert.equal(extractErrorsSection(legacy), legacy);
  });
});

describe('extractBrokenUrls', () => {
  it('retains current lychee timeout sections alongside other errors', () => {
    const current = `# Summary

| Errors | 1 |
| Timeouts | 1 |

## Errors per input

* [404] <https://broken.example/gone> | Not Found

## Timeouts per input

* [TIMEOUT] <https://broken.example/slow> | Timeout

## Redirects per input

* https://working.example/old --[301]--> https://working.example/new
`;
    assert.deepEqual(extractBrokenUrls(current), [
      'https://broken.example/gone',
      'https://broken.example/slow',
    ]);
  });
  it('ignores successful redirects outside the errors section', () => {
    const shortReport = `## Errors per input

### Errors in docs/reference.md

* [502] <https://broken.example/reference> (at 1:1) | Rejected status code: 502

## Redirects per input

### Redirects in README.md

* https://working.example/old --[301]--> https://working.example/current
`;

    assert.deepEqual(extractBrokenUrls(shortReport), [
      'https://broken.example/reference',
    ]);
  });

  it('parses the full document when the errors section is absent', () => {
    const legacyReport = `# Link report

* [404] https://broken.example/legacy
`;

    assert.deepEqual(extractBrokenUrls(legacyReport), [
      'https://broken.example/legacy',
    ]);
  });

  it('extracts every http error from a full report exactly once', () => {
    assert.deepEqual(extractBrokenUrls(report), [
      'https://example.com/csharp/',
      'https://example.com/rust/link_cli/',
    ]);
  });
});

describe('extractBrokenLinks', () => {
  it('reports errors that the Wayback Machine cannot answer', () => {
    const { others } = extractBrokenLinks(report);
    assert.equal(
      others.length,
      2,
      'the missing DocFX file and the unresolvable root-relative link must not be silently dropped'
    );
    assert.ok(
      others.some((link) => link.endsWith('Foundation.Data.Doublets.Cli.yml')),
      'the missing local file must be reported'
    );
    assert.ok(
      others.includes('error:'),
      'the unresolvable root-relative link must be reported'
    );
  });

  it('never classifies a non-http error as a URL', () => {
    const localOnly = `## Errors per input

### Errors in docs/index.md

* [ERROR] <file:///repo/docs/api/Some.Type.yml> (at 15:12) | File not found. Check if file exists and path is correct
`;

    const { urls, others } = extractBrokenLinks(localOnly);
    assert.deepEqual(urls, []);
    assert.deepEqual(others, ['file:///repo/docs/api/Some.Type.yml']);
  });

  it('matches the error count lychee itself reports', () => {
    const { urls, others } = extractBrokenLinks(report);
    const reported = Number(/🚫 Errors\s*\|\s*(\d+)/.exec(report)[1]);
    assert.equal(urls.length + others.length, reported);
  });
});

describe('check-web-archive.mjs end to end', () => {
  itUnless(sandboxed)(
    'fails when the only lychee errors have no http URL to archive',
    async () => {
      const scriptPath = join(here, '..', 'scripts', 'check-web-archive.mjs');
      const workDir = mkdtempSync(join(tmpdir(), 'web-archive-'));
      const reportPath = join(workDir, 'out.md');
      const outputPath = join(workDir, 'github-output.txt');
      writeFileSync(
        reportPath,
        `# Link Checker Report

| Errors | 1 |

## Errors per input

### Errors in docs/index.md

* [ERROR] <file:///repo/docs/api/Some.Type.yml> (at 15:12) | File not found. Check if file exists and path is correct
`
      );
      writeFileSync(outputPath, '');

      const result = spawnSync(process.execPath, [scriptPath], {
        encoding: 'utf-8',
        env: {
          ...process.env,
          LYCHEE_OUTPUT: reportPath,
          GITHUB_OUTPUT: outputPath,
        },
      });

      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout, /Some.Type.yml/);
      assert.match(readFileSync(outputPath, 'utf-8'), /all_archived=false/);
      rmSync(workDir, { recursive: true, force: true });
    }
  );
});
