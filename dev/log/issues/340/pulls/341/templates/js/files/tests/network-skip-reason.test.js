import { describe, expect, it } from 'test-anywhere';
import { networkSkipReason } from './helpers/network.js';

const url = 'https://unpkg.com/use-m/use.js';

describe('network integration skip diagnostics', () => {
  for (const state of ['prompt', 'denied']) {
    it(`reports Deno ${state} permission without sending a request`, async () => {
      let fetched = false;
      const runtime = {
        permissions: {
          query: async (descriptor) => {
            expect(descriptor).toEqual({ name: 'net', host: 'unpkg.com' });
            return { state };
          },
        },
      };
      expect(
        await networkSkipReason({
          url,
          runtime,
          fetchFn: async () => {
            fetched = true;
          },
        })
      ).toBe(`Deno net permission for unpkg.com is ${state}`);
      expect(fetched).toBe(false);
    });
  }

  it('sends a bounded HEAD request when permission is granted', async () => {
    const runtime = {
      permissions: { query: async () => ({ state: 'granted' }) },
    };
    expect(
      await networkSkipReason({
        url,
        runtime,
        fetchFn: async (input, options) => {
          expect(input).toBe(url);
          expect(options.method).toBe('HEAD');
          expect(typeof options.signal.addEventListener).toBe('function');
          return { ok: true };
        },
      })
    ).toBe(null);
  });

  it('reports HTTP failure status separately from transport errors', async () => {
    expect(
      await networkSkipReason({
        url,
        runtime: null,
        fetchFn: async () => ({ ok: false, status: 503 }),
      })
    ).toBe(`${url} answered HTTP 503`);
  });

  it('preserves the underlying transport error', async () => {
    expect(
      await networkSkipReason({
        url,
        runtime: null,
        fetchFn: async () => {
          throw new Error('fetch failed', {
            cause: new Error('ENOTFOUND unpkg.com'),
          });
        },
      })
    ).toBe(`${url} is unreachable (ENOTFOUND unpkg.com)`);
  });
});
