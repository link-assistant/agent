import { describe, expect, test } from 'bun:test';
import { DEFAULT_GATEWAY_MODEL, runMockTurn } from './fixtures/mock-turn';
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
    expect(DEFAULT_GATEWAY_MODEL).toBe(
      'nvidia/nemotron-3-ultra-550b-a55b:free'
    );
    expect(new Set(result.requests.map((request) => request.model))).toEqual(
      new Set([DEFAULT_GATEWAY_MODEL])
    );
    expect(context).not.toContain('title API call failed');
    expect(result.stdout).toContain('hello');
  }, 60000);
  test('deprecated kilo/nemotron-3-super-free runs on Ultra with a warning (#335)', async () => {
    const result = await runMockTurn('kilo', {
      args: ['--model', 'kilo/nemotron-3-super-free'],
    });
    const context = `${result.stdout}\n${result.stderr}`;
    expect(result.exitCode, context).toBe(0);
    expect(result.requests.length).toBeGreaterThan(0);
    expect(new Set(result.requests.map((request) => request.model))).toEqual(
      new Set(['nvidia/nemotron-3-ultra-550b-a55b:free'])
    );
    expect(context).not.toContain('nvidia/nemotron-3-super-120b-a12b:free');
    const warnings = result.stdout
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line))
      .filter(
        (line) =>
          line.type === 'log' &&
          line.level === 'warn' &&
          line.deprecatedModel === 'kilo/nemotron-3-super-free'
      );
    // The warning is logged once per alias and process.
    expect(warnings.length, JSON.stringify(warnings)).toBe(1);
    expect(warnings[0].replacement).toBe('kilo/nemotron-3-ultra-free');
    expect(result.stdout).toContain('hello');
  }, 60000);
  test('Zen FreeTierError makes one request and exits with the client restriction', async () => {
    const result = await runMockTurn('opencode', { refusal: true });
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
