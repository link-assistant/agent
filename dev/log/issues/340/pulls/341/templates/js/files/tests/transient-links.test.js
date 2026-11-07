import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'test-anywhere';
import {
  parseLycheeFailures,
  recheckUnanswered,
} from '../scripts/recheck-broken-links.mjs';

const url = 'https://github.com/owner/repo/blob/main/src/index.js';
const base = { accept: '200..=299', userAgent: 'lychee' };

describe('transient link failures', () => {
  it('classifies cached 503 and rejected 429 as retryable, preserving 404', () => {
    const failures = parseLycheeFailures(
      [
        `- [503] <${url}> | Error (cached)`,
        `- [ERROR] <${url}> | Rejected status code: 429 Too Many Requests`,
        `- [404] <${url}> | Not Found`,
      ].join('\n')
    );
    expect(failures.map((item) => item.retryable)).toEqual([true, true, false]);
  });

  it('backs off between transient answers and recovers only on success', async () => {
    let now = 0;
    const waits = [];
    const statuses = [503, 429, 200];
    const result = await recheckUnanswered([url], {
      ...base,
      nowFn: () => now,
      sleepFn: async (ms) => {
        waits.push(ms);
        now += ms;
      },
      fetchImpl: async () => ({ status: statuses.shift() }),
    });
    expect(result.recovered).toEqual([url]);
    expect(waits).toEqual([5000, 10000]);
  });

  it('uses authenticated contents GET for GitHub blob and tree throttling', async () => {
    for (const kind of ['blob', 'tree']) {
      const page = `https://github.com/owner/repo/${kind}/release%2Fv1/src/a%20b.js`;
      const calls = [];
      const result = await recheckUnanswered([page], {
        ...base,
        githubToken: 'test-token',
        fetchImpl: async (target, init) => {
          calls.push({ target, init });
          return { status: calls.length === 1 ? 503 : 200 };
        },
      });
      expect(result.recovered).toEqual([page]);
      expect(calls[0].init.headers.authorization).toBe(undefined);
      expect(calls[1].target).toBe(
        'https://api.github.com/repos/owner/repo/contents/src/a%20b.js?ref=release%2Fv1'
      );
      expect(calls[1].init.method).toBe('GET');
      expect(calls[1].init.headers.authorization).toBe('Bearer test-token');
      expect(calls[1].init.redirect).toBe('error');
    }
  });

  it('does not recover on an API denial and keeps credentials off unrelated hosts', async () => {
    let now = 0;
    const calls = [];
    const result = await recheckUnanswered(
      [url, 'https://other.example/page'],
      {
        ...base,
        githubToken: 'test-token',
        budgetSeconds: 1,
        nowFn: () => now,
        fetchImpl: async (target, init) => {
          calls.push({ target, init });
          now += 100;
          return {
            status: target.startsWith('https://api.github.com/') ? 401 : 503,
          };
        },
      }
    );
    expect(result.recovered).toEqual([]);
    expect(result.stillBroken.length).toBe(2);
    const other = calls.find((call) =>
      call.target.startsWith('https://other.example/')
    );
    expect(other.init.headers.authorization).toBe(undefined);
  });

  it('never retries a definitive 404 or uses an API answer to hide it', async () => {
    let calls = 0;
    const result = await recheckUnanswered([url], {
      ...base,
      githubToken: 'test-token',
      fetchImpl: async () => {
        calls++;
        return { status: 404 };
      },
    });
    expect(calls).toBe(1);
    expect(result.recovered).toEqual([]);
  });

  it('bounds persistent 503 errors by the shared wall-clock budget', async () => {
    let now = 0;
    let calls = 0;
    const result = await recheckUnanswered([url], {
      ...base,
      budgetSeconds: 16,
      nowFn: () => now,
      sleepFn: async (ms) => {
        now += ms;
      },
      fetchImpl: async () => {
        calls++;
        return { status: 503 };
      },
    });
    expect(calls).toBe(3);
    expect(result.recovered).toEqual([]);
    expect(result.stillBroken.length).toBe(1);
  });

  it('pins every Bun setup to the supported major line', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
    expect(workflow).not.toContain('bun-version: latest');
    expect(workflow).toContain("bun-version: '1.x'");
  });
});
