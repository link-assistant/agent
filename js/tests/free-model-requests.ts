import { describe, expect, test } from 'bun:test';
import { runMockTurn } from '../../experiments/issue-327/mock-turn';
import { APICallError } from 'ai';
import { MessageV2 } from '../src/session/message-v2';
import { RetryFetch } from '../src/provider/retry-fetch';

describe('free model HTTP requests (#327)', () => {
  test('default turn and session title send the served Kilo ID', async () => {
    const result = await runMockTurn('kilo');
    const context = `${result.stdout}\n${result.stderr}`;
    expect(result.exitCode, context).toBe(0);
    expect(result.requests.some((request) => request.stream)).toBe(true);
    expect(result.requests.some((request) => !request.stream)).toBe(true);
    expect(new Set(result.requests.map((request) => request.model))).toEqual(
      new Set(['nvidia/nemotron-3-super-120b-a12b:free'])
    );
    expect(context).not.toContain('title API call failed');
    expect(result.stdout).toContain('hello');
  }, 60000);
  test('Zen FreeTierError makes one request and exits with the client restriction', async () => {
    const result = await runMockTurn('opencode', true);
    expect(result.exitCode).toBe(1);
    expect(result.requests).toHaveLength(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain('OpenCode clients');
  }, 60000);
  test('fetch retry layer preserves a typed 403 body without retrying', async () => {
    let calls = 0;
    const body = JSON.stringify({ error: { type: 'FreeTierError' } });
    const retryFetch = RetryFetch.create({
      baseFetch: (async () => {
        calls++;
        return new Response(body, { status: 403 });
      }) as typeof fetch,
    });
    const response = await retryFetch('http://example.test');
    expect(await response.text()).toBe(body);
    expect(calls).toBe(1);
  });
  test('unrelated and malformed 403 errors keep their original message', () => {
    for (const responseBody of [
      'not JSON',
      JSON.stringify({ error: { type: 'PermissionDenied' } }),
    ]) {
      const error = new APICallError({
        message: 'Permission denied',
        url: 'http://example.test',
        requestBodyValues: {},
        statusCode: 403,
        isRetryable: false,
        responseBody,
      });
      const normalized = MessageV2.fromError(error, { providerID: 'opencode' });
      expect(normalized.data.message).toBe('Permission denied');
      expect(normalized.data.isRetryable).toBe(false);
    }
  });
  test('normalizes raw provider envelopes as well as SDK errors', () => {
    const error = {
      status: 403,
      error: { type: 'FreeTierError', message: 'Forbidden' },
    };
    const normalized = MessageV2.fromError(error, { providerID: 'opencode' });
    expect(normalized.data.isRetryable).toBe(false);
    expect(normalized.data.message).toContain('OpenCode clients');
  });
});
