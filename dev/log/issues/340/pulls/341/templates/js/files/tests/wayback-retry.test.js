import assert from 'node:assert/strict';
import { describe, it } from 'test-anywhere';
import * as archive from '../scripts/check-web-archive.mjs';

const snapshot = {
  archived_snapshots: {
    closest: {
      available: true,
      url: 'http://web.archive.org/web/20240101000000/https://example.com/',
      timestamp: '20240101000000',
    },
  },
};
const json = (data) => ({ ok: true, json: async () => data });
const url = 'https://example.com/';

describe('Wayback lookup outcomes', () => {
  for (const first of [
    { ok: false, status: 429 },
    { ok: false, status: 503 },
    new TypeError('fetch failed', {
      cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
    }),
    {
      ok: true,
      json: async () => {
        throw new SyntaxError('bad JSON');
      },
    },
    json({ unexpected: true }),
    json({ archived_snapshots: [] }),
    json({ archived_snapshots: { closest: { available: true } } }),
    json({ archived_snapshots: { closest: { available: null } } }),
  ]) {
    it(`retries ${first.status ?? first.message ?? 'unreadable answer'} then finds a snapshot`, async () => {
      let calls = 0;
      const delays = [];
      const result = await archive.checkWaybackMachine(url, {
        fetchImpl: async () => {
          calls++;
          if (calls === 1) {
            if (first instanceof Error) {
              throw first;
            }
            return first;
          }
          return json(snapshot);
        },
        sleep: async (delay) => delays.push(delay),
        delayMs: 10,
      });
      assert.equal(calls, 2);
      assert.deepEqual(delays, [10]);
      assert.equal(result.available, true);
      assert.match(result.archiveUrl, /^https:\/\//);
    });
  }

  it('does not retry a confirmed empty archive or a permanent HTTP error', async () => {
    for (const response of [
      json({ archived_snapshots: {} }),
      { ok: false, status: 403 },
    ]) {
      let calls = 0;
      const result = await archive.checkWaybackMachine(url, {
        fetchImpl: async () => {
          calls++;
          return response;
        },
      });
      assert.equal(calls, 1);
      assert.equal(result.available, false);
      assert.equal(result.error, response.status ? 'HTTP 403' : undefined);
    }
  });

  it('reports exhausted retries with cause and exponential backoff', async () => {
    const delays = [];
    const result = await archive.checkWaybackMachine(url, {
      fetchImpl: async () => {
        throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
      },
      delayMs: 10,
      sleep: async (delay) => delays.push(delay),
    });
    assert.equal(result.error, 'fetch failed: ECONNRESET (after 3 attempts)');
    assert.deepEqual(delays, [10, 20]);
  });

  it('aborts each stalled request and body read', async () => {
    for (const body of [false, true]) {
      const result = await archive.checkWaybackMachine(url, {
        attempts: 1,
        timeoutMs: 10,
        fetchImpl: async (_url, { signal }) => {
          const stalled = new Promise((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason))
          );
          return body ? { ok: true, json: () => stalled } : stalled;
        },
      });
      assert.match(result.error, /Timed out.*after 1 attempts/);
    }
  });
});
