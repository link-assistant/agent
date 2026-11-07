// Regression tests for the link re-check (issue #168) and the Wayback
// Machine fallback that honours it.
//
// lychee's --max-retries cannot retry a connection reset during connect, so
// a healthy URL behind a RST is reported broken without a single retry. The
// re-check asks those URLs again; a failure carrying a status code stays
// final.
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  extractLycheeRequestOptions,
  parseAcceptRanges,
  parseLycheeFailures,
  recheckUnanswered,
} from './recheck-broken-links.mjs';
import { splitRecoveredUrls } from './check-web-archive.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const fixtureReport = readFileSync(
  path.join(here, 'fixtures', 'lychee-report.md'),
  'utf8'
);
const linksWorkflow = readFileSync(
  path.join(repoRoot, '.github', 'workflows', 'links.yml'),
  'utf8'
);

function once(fn) {
  let called = false;
  return (...args) => {
    if (called) {
      throw new Error('fetch called twice');
    }
    called = true;
    return fn(...args);
  };
}

describe('lychee report classification', () => {
  it('preserves adjacent description-free failures and ignores other sections', () => {
    for (const newline of ['\n', '\r\n']) {
      const report = [
        '## Successful links', '* [200] https://example.com/ok',
        '## Errors per input', '### Errors in README.md',
        '* [404] https://example.com/missing',
        '* [ERROR] https://example.com/reset',
        '- [TIMEOUT] <https://example.com/slow> (at 1:2)',
        '- [ERROR] <https://example.com/busy> | Rejected status code: 503',
        '## Redirects per input', '* [301] https://example.com/moved',
      ].join(newline);
      assert.deepEqual(parseLycheeFailures(report), [
        { marker: '404', url: 'https://example.com/missing', detail: '', answered: true, retryable: false },
        { marker: 'ERROR', url: 'https://example.com/reset', detail: '', answered: false, retryable: true },
        { marker: 'TIMEOUT', url: 'https://example.com/slow', detail: '', answered: false, retryable: true },
        { marker: 'ERROR', url: 'https://example.com/busy', detail: 'Rejected status code: 503', answered: true, retryable: true },
      ]);
    }
  });

  it('marks a failure carrying a status code as final', () => {
    const failures = parseLycheeFailures(fixtureReport);
    const answered = failures.filter((failure) => failure.answered);

    assert.equal(answered.length, 2);
    assert.deepEqual(answered.map((failure) => failure.url), [
      'https://link-foundation.github.io/missing/csharp/',
      'https://link-foundation.github.io/missing/rust/',
    ]);
    assert.ok(answered[0].detail.includes('Rejected status code'));
  });

  it('marks ERROR, TIMEOUT, and UNKNOWN markers as never answered', () => {
    const report = [
      '- [ERROR] <https://example.com/reset> | Connection reset by peer',
      '- [TIMEOUT] <https://example.com/slow> | Timeout',
      '- [UNKNOWN] <https://example.com/dark> | Unknown error',
    ].join('\n');
    const failures = parseLycheeFailures(report);

    assert.ok(failures.every((failure) => !failure.answered));
    assert.deepEqual(
      failures.map((failure) => failure.marker),
      ['ERROR', 'TIMEOUT', 'UNKNOWN']
    );
  });

  it('treats a rejected status code as an answer whatever the marker', () => {
    const report =
      '- [ERROR] <https://example.com/gone> | Rejected status code: 503 Service Unavailable';

    assert.equal(parseLycheeFailures(report)[0].answered, true);
  });

  it('keeps non-http failures out of the re-check even when unanswered', () => {
    const failures = parseLycheeFailures(fixtureReport);
    const unanswerable = failures.filter(
      (failure) => !failure.answered && !/^https?:\/\//i.test(failure.url)
    );

    assert.deepEqual(
      unanswerable.map((failure) => failure.url).sort(),
      [
        'error:',
        'file:///home/runner/work/repo/repo/docs/api/Some.Type.yml',
      ]
    );
  });
});

describe('lychee request option sharing', () => {
  // The re-check must judge a URL by the same rules lychee used. Neither
  // flag is set in links.yml today, so lychee's documented defaults apply on
  // both sides; if either side changes, this test fails until the other
  // follows.
  it('reads the same accept list and user agent as the lychee step', () => {
    const options = extractLycheeRequestOptions(linksWorkflow);

    assert.equal(options.accept, '100..=103,200..=299');
    assert.equal(options.userAgent, 'lychee');
    assert.ok(!linksWorkflow.includes('--accept'));
    assert.ok(!linksWorkflow.includes('--user-agent'));
  });

  it('extracts the flags when the workflow sets them', () => {
    const workflow = [
      '        args: >-',
      '          --verbose',
      '          --accept 200..=299,429',
      '          --user-agent my-checker/2.0',
    ].join('\n');
    const options = extractLycheeRequestOptions(workflow);

    assert.equal(options.accept, '200..=299,429');
    assert.equal(options.userAgent, 'my-checker/2.0');
  });
});

describe('accept list parsing', () => {
  it('honours ranges, singles, and stray spaces', () => {
    const accepted = parseAcceptRanges(' 100..=103 , 200..=299, 429 ');

    assert.equal(accepted(100), true);
    assert.equal(accepted(103), true);
    assert.equal(accepted(200), true);
    assert.equal(accepted(299), true);
    assert.equal(accepted(429), true);
    assert.equal(accepted(104), false);
    assert.equal(accepted(404), false);
  });
});

describe('re-check requests', () => {
  for (const status of [429, 500, 502, 503, 504]) {
    it(`retries transient HTTP ${status} until it recovers`, async () => {
      let calls = 0;
      const result = await recheckUnanswered(['https://a.example/flaky'], {
        accept: '200..=299',
        userAgent: 'lychee',
        budgetSeconds: 2,
        initialWaitMs: 1,
        fetchImpl: async () => ({ status: ++calls === 1 ? status : 200 }),
      });
      assert.equal(calls, 2);
      assert.deepEqual(result.recovered, ['https://a.example/flaky']);
      assert.deepEqual(result.stillBroken, []);
    });
  }

  it('bounds repeated 503 responses and leaves the link failed', async () => {
    let calls = 0;
    const result = await recheckUnanswered(['https://a.example/flaky'], {
      accept: '200..=299', userAgent: 'lychee',
      budgetSeconds: 0.03, initialWaitMs: 5,
      fetchImpl: async () => { calls += 1; return { status: 503 }; },
    });
    assert.ok(calls > 0 && calls < 10);
    assert.deepEqual(result.recovered, []);
    assert.equal(result.stillBroken.length, 1);
  });

  it('recovers a URL that answers accepted', async () => {
    const result = await recheckUnanswered(['https://a.example/x'], {
      accept: '200..=299',
      userAgent: 'lychee',
      fetchImpl: once(() => Promise.resolve({ status: 200 })),
    });

    assert.deepEqual(result.recovered, ['https://a.example/x']);
    assert.deepEqual(result.stillBroken, []);
  });

  it('stops at the first rejected answer and never retries it', async () => {
    let calls = 0;
    const result = await recheckUnanswered(['https://a.example/x'], {
      accept: '200..=299',
      userAgent: 'lychee',
      budgetSeconds: 5,
      initialWaitMs: 1,
      fetchImpl: () => {
        calls += 1;
        return Promise.resolve({ status: 404 });
      },
    });

    assert.equal(calls, 1);
    assert.deepEqual(result.recovered, []);
    assert.deepEqual(result.stillBroken, [
      {
        url: 'https://a.example/x',
        status: 404,
        reason: 'answered 404, which lychee does not accept',
      },
    ]);
  });

  it('retries a URL that never answers and takes a later success', async () => {
    let calls = 0;
    const result = await recheckUnanswered(['https://a.example/x'], {
      accept: '200..=299',
      userAgent: 'lychee',
      budgetSeconds: 30,
      initialWaitMs: 1,
      fetchImpl: () => {
        calls += 1;
        if (calls < 3) {
          return Promise.reject(new Error('ECONNRESET'));
        }
        return Promise.resolve({ status: 204 });
      },
    });

    assert.equal(calls, 3);
    assert.deepEqual(result.recovered, ['https://a.example/x']);
  });

  it('gives up without an answer once the budget expires', async () => {
    const result = await recheckUnanswered(['https://a.example/x'], {
      accept: '200..=299',
      userAgent: 'lychee',
      budgetSeconds: 0,
      fetchImpl: () => Promise.reject(new Error('ECONNRESET')),
    });

    assert.deepEqual(result.recovered, []);
    assert.equal(result.stillBroken[0].status, null);
    assert.ok(result.stillBroken[0].reason.includes('no accepted response'));
  });

  it('asks a duplicated URL only once', async () => {
    let calls = 0;
    const result = await recheckUnanswered(
      ['https://a.example/x', 'https://a.example/x'],
      {
        accept: '200..=299',
        userAgent: 'lychee',
        fetchImpl: once(() => {
          calls += 1;
          return Promise.resolve({ status: 200 });
        }),
      }
    );

    assert.equal(calls, 1);
    assert.deepEqual(result.recovered, ['https://a.example/x']);
  });

  it('sends the request the way lychee was configured to', async () => {
    let seen;
    await recheckUnanswered(['https://a.example/x'], {
      accept: '200..=299',
      userAgent: 'my-checker/2.0',
      fetchImpl: (url, init) => {
        seen = { url, init };
        return Promise.resolve({ status: 200 });
      },
    });

    assert.equal(seen.url, 'https://a.example/x');
    assert.equal(seen.init.method, 'GET');
    assert.equal(seen.init.headers['user-agent'], 'my-checker/2.0');
  });
});

describe('re-check step end to end', () => {
  function writeReport(dir, entries) {
    const reportPath = path.join(dir, 'out.md');
    writeFileSync(reportPath, `## Errors per input\n\n${entries.join('\n')}\n`);
    return reportPath;
  }

  function runRecheck(env) {
    return new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [path.join(here, 'recheck-broken-links.mjs')],
        {
          cwd: repoRoot,
          env: { ...process.env, ...env },
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
      });
      child.stderr.on('data', (chunk) => {
        output += chunk;
      });
      child.on('close', (code) => resolve({ code, output }));
    });
  }

  it('recovers numeric 429 and rejected 503 reports after backoff', async () => {
    const requests = new Map();
    const server = createServer((request, response) => {
      const count = (requests.get(request.url) || 0) + 1;
      requests.set(request.url, count);
      response.writeHead(count === 1 ? (request.url === '/limited' ? 429 : 503) : 200);
      response.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const dir = mkdtempSync(path.join(tmpdir(), 'recheck-'));
    try {
      const reportPath = writeReport(dir, [
        `- [429] <${base}/limited> | Too Many Requests`,
        `- [ERROR] <${base}/unavailable> | Rejected status code: 503 Service Unavailable`,
      ]);
      const outputPath = path.join(dir, 'github-output.txt');
      const { code } = await runRecheck({
        LYCHEE_OUTPUT: reportPath,
        RECOVERED_OUTPUT: path.join(dir, 'recovered.txt'),
        GITHUB_OUTPUT: outputPath,
        RECHECK_WAIT_MS: '10',
        RECHECK_BUDGET_SECONDS: '5',
      });
      assert.equal(code, 0);
      assert.equal(requests.get('/limited'), 2);
      assert.equal(requests.get('/unavailable'), 2);
      assert.ok(readFileSync(outputPath, 'utf8').includes('all_recovered=true'));
    } finally {
      await new Promise((resolve) => server.close(resolve));
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('recovers only the URLs that answer healthy and never re-asks a 404', async () => {
    const requests = [];
    const server = createServer((request, response) => {
      requests.push(request.url);
      if (request.url === '/healthy') {
        response.writeHead(200);
      } else {
        response.writeHead(404);
      }
      response.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const dir = mkdtempSync(path.join(tmpdir(), 'recheck-'));
    try {
      const reportPath = writeReport(dir, [
        `- [ERROR] <${base}/healthy> | Connection reset by peer`,
        `- [ERROR] <${base}/dead> | Connection reset by peer`,
        '- [404] <https://example.com/final/> | Rejected status code: 404 Not Found',
      ]);
      const recoveredPath = path.join(dir, 'recovered.txt');
      const outputPath = path.join(dir, 'github-output.txt');

      const { code, output } = await runRecheck({
        LYCHEE_OUTPUT: reportPath,
        RECOVERED_OUTPUT: recoveredPath,
        GITHUB_OUTPUT: outputPath,
        RECHECK_WAIT_MS: '10',
        RECHECK_BUDGET_SECONDS: '30',
      });

      assert.equal(code, 0);
      assert.equal(readFileSync(recoveredPath, 'utf8'), `${base}/healthy\n`);
      assert.deepEqual(requests.slice().sort(), ['/dead', '/healthy']);
      // The 404 was already an answer; re-asking it would be wrong.
      assert.ok(!requests.includes('/final'));
      // One link stayed broken, so the gate must not be released.
      assert.equal(existsSync(outputPath), false);
      assert.ok(output.includes('still failed'));
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('releases the gate only when every unanswered link recovered', async () => {
    const server = createServer((request, response) => {
      response.writeHead(200);
      response.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    const dir = mkdtempSync(path.join(tmpdir(), 'recheck-'));
    try {
      const reportPath = writeReport(dir, [
        `- [TIMEOUT] <http://127.0.0.1:${port}/slow> | Timeout`,
      ]);
      const recoveredPath = path.join(dir, 'recovered.txt');
      const outputPath = path.join(dir, 'github-output.txt');

      const { code } = await runRecheck({
        LYCHEE_OUTPUT: reportPath,
        RECOVERED_OUTPUT: recoveredPath,
        GITHUB_OUTPUT: outputPath,
        RECHECK_WAIT_MS: '10',
        RECHECK_BUDGET_SECONDS: '30',
      });

      assert.equal(code, 0);
      assert.ok(readFileSync(outputPath, 'utf8').includes('all_recovered=true'));
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the gate closed when a recovered transport error accompanies a final 404', async () => {
    const server = createServer((request, response) => {
      response.writeHead(200);
      response.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    const dir = mkdtempSync(path.join(tmpdir(), 'recheck-'));
    try {
      const reportPath = writeReport(dir, [
        `- [ERROR] <http://127.0.0.1:${port}/healthy> | Connection reset by peer`,
        '- [404] <https://example.com/final/> | Rejected status code: 404 Not Found',
      ]);
      const outputPath = path.join(dir, 'github-output.txt');

      const { code } = await runRecheck({
        LYCHEE_OUTPUT: reportPath,
        RECOVERED_OUTPUT: path.join(dir, 'recovered.txt'),
        GITHUB_OUTPUT: outputPath,
        RECHECK_WAIT_MS: '10',
        RECHECK_BUDGET_SECONDS: '30',
      });

      assert.equal(code, 0);
      assert.equal(
        existsSync(outputPath),
        false,
        'all_recovered is a verdict about the complete report, not only the re-asked subset'
      );
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 0 even when the report is missing entirely', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'recheck-'));
    try {
      const { code, output } = await runRecheck({
        LYCHEE_OUTPUT: path.join(dir, 'missing.md'),
        RECOVERED_OUTPUT: path.join(dir, 'recovered.txt'),
      });

      assert.equal(code, 0);
      assert.ok(output.includes('treating as no recovery'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('web archive fallback honouring the re-check', () => {
  it('drops recovered URLs from the archive lookup', () => {
    const { remaining, recovered } = splitRecoveredUrls(
      ['https://a.example/x', 'https://b.example/y'],
      'https://b.example/y\n'
    );

    assert.deepEqual(remaining, ['https://a.example/x']);
    assert.deepEqual(recovered, ['https://b.example/y']);
  });

  it('skips nothing when the recovered file is missing or empty', () => {
    const urls = ['https://a.example/x'];
    const fromMissing = splitRecoveredUrls(urls, '');
    const fromNull = splitRecoveredUrls(urls, null);

    assert.deepEqual(fromMissing.remaining, urls);
    assert.deepEqual(fromNull.remaining, urls);
  });
});
