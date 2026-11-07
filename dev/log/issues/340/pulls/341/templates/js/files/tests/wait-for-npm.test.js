import { describe, it, expect } from 'test-anywhere';

import {
  buildPackageVersionUrl,
  checkNpmVersion,
  describeCheckResult,
  formatFailureMessage,
  main,
  normalizeCheckResult,
  parseArgs,
  waitForNpmVersion,
} from '../scripts/wait-for-npm.mjs';

const REGISTRY = 'https://registry.npmjs.org';

function response(status, body, statusText = '') {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    async json() {
      return body;
    },
  };
}

describe('parseArgs', () => {
  it('parses release wait options', () => {
    expect(
      parseArgs(
        [
          '--release-version',
          '1.2.3',
          '--package-name=@scope/pkg',
          '--max-attempts',
          '2',
          '--sleep-seconds=1',
        ],
        {}
      )
    ).toEqual({
      jsRoot: '',
      maxAttempts: 2,
      packageName: '@scope/pkg',
      releaseVersion: '1.2.3',
      sleepSeconds: 1,
    });
  });
});

describe('buildPackageVersionUrl', () => {
  it('builds a version document url for unscoped packages', () => {
    expect(buildPackageVersionUrl('react', '1.0.0', REGISTRY)).toBe(
      `${REGISTRY}/react/1.0.0`
    );
  });

  it('encodes the scope separator for scoped packages', () => {
    expect(buildPackageVersionUrl('@scope/pkg', '1.2.3-beta.1', REGISTRY)).toBe(
      `${REGISTRY}/@scope%2Fpkg/1.2.3-beta.1`
    );
  });
});

describe('checkNpmVersion', () => {
  it('reports a published version as available', async () => {
    const result = await checkNpmVersion('react', '1.0.0', {
      fetchFn: async () => response(200, { version: '1.0.0' }),
      registryUrl: REGISTRY,
    });

    expect(result.available).toBe(true);
    expect(result.status).toBe('ok');
    expect(result.httpStatus).toBe(200);
  });

  it('sends an accept and user-agent header', async () => {
    let seen;
    await checkNpmVersion('react', '1.0.0', {
      fetchFn: async (url, init) => {
        seen = init;
        return response(200, { version: '1.0.0' });
      },
      registryUrl: REGISTRY,
    });

    expect(seen.headers.accept).toBe('application/json');
    expect(typeof seen.headers['user-agent']).toBe('string');
    expect(seen.headers['user-agent'].length > 0).toBe(true);
  });

  it('reports HTTP 404 as genuinely not published', async () => {
    const result = await checkNpmVersion('react', '999.0.0', {
      fetchFn: async () => response(404, {}, 'Not Found'),
      registryUrl: REGISTRY,
    });

    expect(result.url).toContain(`${REGISTRY}/react/999.0.0?cache-bust=`);
    expect({ ...result, url: 'fresh registry URL' }).toEqual({
      available: false,
      status: 'not-published',
      httpStatus: 404,
      url: 'fresh registry URL',
    });
  });

  it('reports a 5xx as unknown, not as a missing version', async () => {
    const result = await checkNpmVersion('react', '1.0.0', {
      fetchFn: async () => response(503, {}, 'Service Unavailable'),
      registryUrl: REGISTRY,
    });

    expect(result.available).toBe(false);
    expect(result.status).toBe('unknown');
    expect(result.httpStatus).toBe(503);
    expect(result.error).toBe('503 Service Unavailable');
  });

  it('reports a 403 as unknown', async () => {
    const result = await checkNpmVersion('react', '1.0.0', {
      fetchFn: async () => response(403, {}, 'Forbidden'),
      registryUrl: REGISTRY,
    });

    expect(result.status).toBe('unknown');
    expect(result.httpStatus).toBe(403);
  });

  it('reports a network failure as unknown and keeps the reason', async () => {
    const result = await checkNpmVersion('react', '1.0.0', {
      fetchFn: async () => {
        throw new Error('getaddrinfo EAI_AGAIN registry.npmjs.org');
      },
      registryUrl: REGISTRY,
    });

    expect(result.status).toBe('unknown');
    expect(result.error).toBe('getaddrinfo EAI_AGAIN registry.npmjs.org');
    expect(result.url).toContain(`${REGISTRY}/react/1.0.0?cache-bust=`);
  });

  it('reports a version mismatch as ok but unavailable', async () => {
    const result = await checkNpmVersion('react', '1.0.0', {
      fetchFn: async () => response(200, { version: '1.0.1' }),
      registryUrl: REGISTRY,
    });

    expect(result.available).toBe(false);
    expect(result.status).toBe('ok');
  });

  it('reports an invalid package name as unknown', async () => {
    const result = await checkNpmVersion('', '1.0.0', {
      fetchFn: async () => response(200, { version: '1.0.0' }),
      registryUrl: REGISTRY,
    });

    expect(result.status).toBe('unknown');
    expect(result.available).toBe(false);
  });
});

describe('normalizeCheckResult', () => {
  it('keeps boolean results working', () => {
    expect(normalizeCheckResult(true)).toEqual({
      available: true,
      status: 'ok',
    });
    expect(normalizeCheckResult(false)).toEqual({
      available: false,
      status: 'not-published',
    });
  });

  it('defaults an unrecognized result to unknown', () => {
    expect(normalizeCheckResult(undefined)).toEqual({
      available: false,
      status: 'unknown',
    });
  });
});

describe('describeCheckResult', () => {
  it('describes each status distinctly', () => {
    expect(
      describeCheckResult({ available: true, status: 'ok', httpStatus: 200 })
    ).toBe('available (HTTP 200)');
    expect(
      describeCheckResult({
        available: false,
        status: 'not-published',
        httpStatus: 404,
      })
    ).toBe('not published yet (HTTP 404)');
    expect(
      describeCheckResult({
        available: false,
        status: 'unknown',
        httpStatus: 503,
        error: '503 Service Unavailable',
      })
    ).toBe('check failed: HTTP 503 503 Service Unavailable');
  });
});

describe('waitForNpmVersion', () => {
  it('retries until npm reports the requested version', async () => {
    let attempts = 0;
    const sleeps = [];

    const result = await waitForNpmVersion({
      checkAvailability(packageName, version) {
        attempts++;
        expect(packageName).toBe('@scope/pkg');
        expect(version).toBe('1.2.3');
        return { available: attempts === 2, status: 'not-published' };
      },
      maxAttempts: 3,
      packageName: '@scope/pkg',
      sleepFn(seconds) {
        sleeps.push(seconds);
        return Promise.resolve();
      },
      sleepSeconds: 1,
      stdout() {},
      version: '1.2.3',
    });

    expect(result.available).toBe(true);
    expect(result.attempts).toBe(2);
    expect(sleeps).toEqual([1]);
  });

  it('carries the last unknown status out of an exhausted wait', async () => {
    const result = await waitForNpmVersion({
      checkAvailability: () => ({
        available: false,
        status: 'unknown',
        error: '503 Service Unavailable',
        url: `${REGISTRY}/react/1.0.0`,
      }),
      maxAttempts: 2,
      packageName: 'react',
      sleepFn: () => Promise.resolve(),
      sleepSeconds: 1,
      stdout() {},
      version: '1.0.0',
    });

    expect(result.available).toBe(false);
    expect(result.status).toBe('unknown');
    expect(result.attempts).toBe(2);
    expect(result.error).toBe('503 Service Unavailable');
  });

  it('logs the outcome of every attempt', async () => {
    const lines = [];
    await waitForNpmVersion({
      checkAvailability: () => ({
        available: false,
        status: 'unknown',
        httpStatus: 503,
      }),
      maxAttempts: 2,
      packageName: 'react',
      sleepFn: () => Promise.resolve(),
      sleepSeconds: 1,
      stdout: (line) => lines.push(line),
      version: '1.0.0',
    });

    expect(lines.length).toBe(2);
    expect(lines[0].includes('attempt 1/2')).toBe(true);
    expect(lines[0].includes('HTTP 503')).toBe(true);
  });
});

describe('formatFailureMessage', () => {
  it('asserts a failed release only when npm answered', () => {
    expect(
      formatFailureMessage('react@1.0.0', { status: 'not-published' }, 2)
    ).toBe('react@1.0.0 did not become available on npm');
  });

  it('does not blame the release when the registry was unreachable', () => {
    const message = formatFailureMessage(
      'react@1.0.0',
      {
        status: 'unknown',
        error: 'getaddrinfo EAI_AGAIN',
        url: `${REGISTRY}/react/1.0.0`,
      },
      2
    );

    expect(message.includes('Could not determine')).toBe(true);
    expect(message.includes('does NOT mean the publish failed')).toBe(true);
    expect(message.includes('getaddrinfo EAI_AGAIN')).toBe(true);
    expect(message.includes(`${REGISTRY}/react/1.0.0`)).toBe(true);
    expect(message.includes('did not become available')).toBe(false);
  });
});

describe('wait-for-npm main', () => {
  it('reports an unreachable registry distinctly from a missing version', async () => {
    const errors = [];
    const code = await main({
      argv: [
        '--release-version',
        '1.0.0',
        '--package-name',
        'react',
        '--max-attempts',
        '1',
        '--sleep-seconds',
        '1',
      ],
      env: { NPM_CONFIG_REGISTRY: 'http://127.0.0.1:1' },
      stderr: (line) => errors.push(line),
      stdout() {},
    });

    expect(code).toBe(1);
    expect(errors.length).toBe(1);
    expect(errors[0].includes('Could not determine')).toBe(true);
    expect(errors[0].includes('does NOT mean the publish failed')).toBe(true);
  });
});
