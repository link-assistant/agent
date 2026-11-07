// Regression tests for the lychee report parser used by the Broken Link
// Checker workflow.
//
// Issue #136: lychee errors that are not http(s) URLs (missing local files,
// unresolvable root-relative links) were dropped by the parser, so the script
// printed "No broken URLs found" and set `all_archived=true` for a run in
// which lychee had reported real errors.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  extractBrokenLinks,
  extractBrokenUrls,
  extractErrorsSection,
} from './check-web-archive.mjs';
import * as archive from './check-web-archive.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const report = readFileSync(join(here, 'fixtures', 'lychee-report.md'), 'utf-8');

test('Wayback retries transient HTTP, transport, timeout and malformed answers', async () => {
  for (const failure of [429, 503, new Error('connection reset'),
    new DOMException('timed out', 'TimeoutError'), 'invalid-json', {}]) {
    let calls = 0;
    const delays = [];
    const result = await archive.checkWaybackMachine('https://example.com/a', {
      fetchImpl: async () => {
        calls++;
        if (calls === 1) {
          if (failure instanceof Error) throw failure;
          if (typeof failure === 'number') return new Response('', { status: failure });
          return new Response(failure === 'invalid-json' ? '<html>' : '{}');
        }
        return Response.json({ archived_snapshots: { closest: {
          available: true, url: 'http://web.archive.org/web/20260101/https://example.com/a',
          timestamp: '20260101000000',
        } } });
      },
      sleepImpl: async (ms) => delays.push(ms), delayMs: 7,
    });
    assert.equal(result.available, true);
    assert.ok(result.archiveUrl.startsWith('https://'));
    assert.equal(calls, 2);
    assert.deepEqual(delays, [7]);
  }
});

test('Wayback distinguishes exhaustion, permanent HTTP and definite absence', async () => {
  const delays = [];
  const failed = await archive.checkWaybackMachine('https://example.com', {
    fetchImpl: async () => { throw new Error('fetch failed', { cause: { code: 'ECONNRESET' } }); },
    sleepImpl: async (ms) => delays.push(ms), delayMs: 2,
  });
  assert.match(failed.error, /fetch failed: ECONNRESET \(after 3 attempts\)/);
  assert.deepEqual(delays, [2, 4]);
  for (const [response, expected] of [[new Response('', { status: 403 }), 'HTTP 403'],
    [Response.json({ archived_snapshots: {} }), undefined]]) {
    let calls = 0;
    const result = await archive.checkWaybackMachine('https://example.com', {
      fetchImpl: async () => { calls++; return response; }, delayMs: 0,
    });
    assert.equal(calls, 1);
    assert.equal(result.error, expected);
    assert.equal(result.available, false);
  }
});

test('lookup failure annotation never claims a missing snapshot and closes the output gate', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'archive-verdict-'));
  const saved = { ...process.env };
  const messages = [];
  const log = console.log;
  const error = console.error;
  try {
    const input = join(dir, 'report.md');
    writeFileSync(input, '## Errors per input\n- [404] https://example.com/broken\n');
    process.env.LYCHEE_OUTPUT = input;
    process.env.LYCHEE_EXIT_CODE = '2';
    process.env.RECOVERED_URLS = join(dir, 'not-recovered');
    process.env.GITHUB_OUTPUT = join(dir, 'output');
    console.log = console.error = (...args) => messages.push(args.join(' '));
    const code = await archive.main({
      lookup: async () => ({ available: false, error: 'HTTP 429 (after 3 attempts)' }),
      pause: async () => {},
    });
    assert.equal(code, 1);
    assert.match(messages.join('\n'), /Web Archive lookup failed/);
    assert.doesNotMatch(messages.join('\n'), /No archived version|Not found in Web Archive/);
    assert.doesNotMatch(messages.join('\n'), /Action required: Fix or remove/);
    assert.match(readFileSync(join(dir, 'output'), 'utf8'), /all_archived=false/);
  } finally {
    console.log = log; console.error = error;
    for (const key of ['LYCHEE_OUTPUT', 'LYCHEE_EXIT_CODE', 'RECOVERED_URLS', 'GITHUB_OUTPUT']) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('failed lychee with missing, unreadable, empty or malformed report fails closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'archive-report-'));
  try {
    for (const [name, content] of [['missing', null], ['empty', ''], ['garbage', 'not a report'],
      ['inconsistent', '# Link Checker Report\n| 🚫 Errors | 1 |\n'],
      ['truncated', '## Errors per input\n* [ERROR]'], ['clean-but-failed', '# Link Checker Report\n| 🚫 Errors | 0 |\n']]) {
      const input = join(dir, name);
      const output = join(dir, `${name}-output`);
      if (content !== null) writeFileSync(input, content);
      const result = spawnSync(process.execPath, [join(here, 'check-web-archive.mjs')], {
        env: { ...process.env, LYCHEE_OUTPUT: input, LYCHEE_EXIT_CODE: '2', GITHUB_OUTPUT: output },
        encoding: 'utf8', timeout: 5000,
      });
      assert.notEqual(result.status, 0, name);
      assert.match(readFileSync(output, 'utf8'), /all_archived=false/);
      assert.doesNotMatch(result.stdout, /all_archived=true/);
    }
    const result = spawnSync(process.execPath, [join(here, 'check-web-archive.mjs')], {
      env: { ...process.env, LYCHEE_OUTPUT: dir, LYCHEE_EXIT_CODE: '2', GITHUB_OUTPUT: join(dir, 'unreadable-output') },
      encoding: 'utf8', timeout: 5000,
    });
    assert.notEqual(result.status, 0);
    assert.match(readFileSync(join(dir, 'unreadable-output'), 'utf8'), /all_archived=false/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('valid zero-error and fully recovered reports retain successful verdicts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'archive-clean-'));
  try {
    for (const recovered of [false, true]) {
      const input = join(dir, 'report.md');
      const output = join(dir, `output-${recovered}`);
      const recoveredFile = join(dir, 'recovered.txt');
      writeFileSync(input, recovered
        ? '| 🚫 Errors | 1 |\n## Errors per input\n* [ERROR] https://example.com/recovered\n'
        : '# Link Checker Report\n| 🚫 Errors | 0 |\n');
      writeFileSync(recoveredFile, recovered ? 'https://example.com/recovered\n' : '');
      const result = spawnSync(process.execPath, [join(here, 'check-web-archive.mjs')], {
        env: { ...process.env, LYCHEE_OUTPUT: input, LYCHEE_EXIT_CODE: recovered ? '2' : '0',
          GITHUB_OUTPUT: output, RECOVERED_URLS: recoveredFile },
        encoding: 'utf8', timeout: 5000,
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(readFileSync(output, 'utf8'), /all_archived=true/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the errors section stops at the next top-level heading', () => {
  const section = extractErrorsSection(report);
  assert.ok(section.includes('Errors in README.md'));
  assert.ok(
    !section.includes('Redirects per input'),
    'the redirects section must not leak into the errors section'
  );
});

test('redirected links are not reported as broken', () => {
  const { urls, others } = extractBrokenLinks(report);
  for (const redirected of [
    'https://docs.rs/link-cli',
    'https://github.com/linksplatform/Protocols.Lino',
    'https://habr.com/ru/articles/804617',
  ]) {
    assert.ok(
      ![...urls, ...others].some((link) => link.startsWith(redirected)),
      `${redirected} redirects successfully and must not be treated as broken`
    );
  }
});

test('every http error is extracted exactly once', () => {
  assert.deepEqual(extractBrokenLinks(report).urls, [
    'https://link-foundation.github.io/missing/csharp/',
    'https://link-foundation.github.io/missing/rust/',
  ]);
});

test('errors that the Wayback Machine cannot answer are still reported', () => {
  const { others } = extractBrokenLinks(report);
  assert.deepEqual(others, [
    'file:///home/runner/work/repo/repo/docs/api/Some.Type.yml',
    'error:',
  ]);
});

test('the parsed error count matches the count lychee reports', () => {
  const { urls, others } = extractBrokenLinks(report);
  const reported = Number(/🚫 Errors\s*\|\s*(\d+)/.exec(report)[1]);
  assert.equal(urls.length + others.length, reported);
});

test('a report whose only errors are non-HTTP is not "all archived"', () => {
  const onlyLocalErrors = `## Errors per input

### Errors in docs/index.md

* [ERROR] <file:///repo/docs/does-not-exist.yml> (at 1:1) | File not found. Check if file exists and path is correct
`;

  const { urls, others } = extractBrokenLinks(onlyLocalErrors);
  assert.deepEqual(urls, []);
  assert.deepEqual(others, ['file:///repo/docs/does-not-exist.yml']);
});

test('a report with only redirects yields no broken links', () => {
  const redirectsOnly = `# Link Checker Report

## Redirects per input

### Redirects in README.md

* https://working.example/old --[301]--> https://working.example/current
`;

  assert.deepEqual(extractBrokenLinks(redirectsOnly), { urls: [], others: [] });
});

test('extractBrokenUrls retains full-report parsing for legacy output', () => {
  const legacy = `Broken links

* [404] https://broken.example/legacy | Rejected status code: 404
`;

  assert.deepEqual(extractBrokenUrls(legacy), ['https://broken.example/legacy']);
});
