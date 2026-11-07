/**
 * The Pages deployment script, driven by a scripted Pages API: no case waits
 * or reaches GitHub. actions/deploy-pages@v5 created the deployment with one
 * request and failed the job on a single HTTP 500; the script retries
 * transient failures without ever creating a second deployment of a commit.
 */
import { describe, expect, it } from 'test-anywhere';

import {
  annotation,
  deployPages,
  describe as explain,
  githubApi,
  HttpError,
  isTransient,
  oidcToken,
} from '../scripts/deploy-pages.mjs';

const SHA = 'abc123';
const base = '/repos/owner/site/pages';
const http = (status, text = '', requestId = undefined) =>
  new HttpError(status, text, {
    method: 'POST',
    path: `${base}/deployments`,
    requestId,
  });
const created = { id: 7, page_url: 'https://owner.github.io/site/' };

// Every route answers from its queue; the last answer repeats.
function api(routes) {
  const calls = [];
  const bodies = [];
  const request = async (method, path, body) => {
    calls.push(`${method} ${path}`);
    bodies.push(body);
    const queue = routes[`${method} ${path}`];
    if (!queue) {
      throw new HttpError(404, 'Not Found', { method, path });
    }
    const answer = queue.length > 1 ? queue.shift() : queue[0];
    if (answer instanceof Error) {
      throw answer;
    }
    return answer;
  };
  const posts = () =>
    calls.filter((call) => call === `POST ${base}/deployments`).length;
  return { request, calls, bodies, posts };
}

function run(request, options = {}) {
  const logs = [];
  const sleeps = [];
  const promise = deployPages({
    request,
    getIdToken: async () => 'oidc',
    repository: 'owner/site',
    artifactId: '42',
    buildVersion: SHA,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    log: (line) => logs.push(line),
    ...options,
  });
  return { promise, logs, sleeps };
}

async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

describe('deploy-pages: creating the deployment', () => {
  it('retries an HTTP 500 and publishes the same artifact once', async () => {
    const { request, bodies, posts } = api({
      [`POST ${base}/deployments`]: [
        http(500, 'Internal Server Error'),
        created,
      ],
      [`GET ${base}/deployments/${SHA}`]: [new HttpError(404, 'Not Found')],
      [`GET ${base}/deployments/7`]: [
        { status: 'deployment_queued' },
        { status: 'succeed' },
      ],
    });
    const { promise, sleeps } = run(request);
    expect(await promise).toEqual({
      id: 7,
      pageUrl: 'https://owner.github.io/site/',
    });
    expect(posts()).toBe(2);
    expect(bodies[0]).toEqual({
      artifact_id: 42,
      pages_build_version: SHA,
      oidc_token: 'oidc',
    });
    expect(sleeps[0]).toBe(10000);
  });

  it('retries HTTP 429 and network failures too', async () => {
    for (const failure of [
      http(429, 'Too Many Requests'),
      new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }),
      Object.assign(new Error('The operation timed out'), {
        name: 'TimeoutError',
      }),
    ]) {
      const { request, posts } = api({
        [`POST ${base}/deployments`]: [failure, created],
        [`GET ${base}/deployments/7`]: [{ status: 'succeed' }],
      });
      expect((await run(request).promise).id).toBe(7);
      expect(posts()).toBe(2);
    }
  });

  it('fails a permanent 4xx at once, naming the status and request ID', async () => {
    for (const status of [400, 401, 403, 404, 422]) {
      const { request, calls } = api({
        [`POST ${base}/deployments`]: [http(status, 'Refused', 'AA00:25F91')],
      });
      const error = await rejection(run(request).promise);
      expect(error.message).toContain(`HTTP ${status} Refused`);
      expect(error.message).toContain('request ID AA00:25F91');
      expect(error.message).toContain('after 1 attempt(s)');
      expect(calls).toEqual([`POST ${base}/deployments`]);
    }
  });

  it('gives up after the bounded number of transient failures', async () => {
    const { request, posts } = api({
      [`POST ${base}/deployments`]: [http(503, 'Service Unavailable')],
    });
    const { promise, sleeps } = run(request, { attempts: 3 });
    const error = await rejection(promise);
    expect(error.message).toContain(
      'Creating the Pages deployment failed after 3 attempt(s)'
    );
    expect(posts()).toBe(3);
    expect(sleeps).toEqual([10000, 20000]);
  });

  it('adopts a deployment whose creation response was lost', async () => {
    const { request, posts } = api({
      [`POST ${base}/deployments`]: [new TypeError('fetch failed')],
      [`GET ${base}/deployments/${SHA}`]: [
        { status: 'deployment_in_progress' },
        { status: 'succeed' },
      ],
      [`GET ${base}`]: [{ html_url: 'https://owner.github.io/site/' }],
    });
    const { promise, logs } = run(request);
    expect(await promise).toEqual({
      id: SHA,
      pageUrl: 'https://owner.github.io/site/',
    });
    expect(posts()).toBe(1);
    expect(logs.some((line) => line.startsWith('Adopted'))).toBe(true);
  });

  it('creates a new deployment when the earlier one of this commit failed', async () => {
    const { request, posts } = api({
      [`POST ${base}/deployments`]: [http(502), created],
      [`GET ${base}/deployments/${SHA}`]: [{ status: 'deployment_failed' }],
      [`GET ${base}/deployments/7`]: [{ status: 'succeed' }],
    });
    expect((await run(request).promise).id).toBe(7);
    expect(posts()).toBe(2);
  });

  it('refuses a missing artifact ID before calling the API', async () => {
    for (const artifactId of [undefined, '', 'abc']) {
      const { request, calls } = api({});
      const error = await rejection(run(request, { artifactId }).promise);
      expect(error.message).toContain('Missing Pages artifact ID');
      expect(calls).toEqual([]);
    }
  });
});

describe('deploy-pages: waiting for the deployment', () => {
  it('fails the step on every final failed state', async () => {
    for (const [status, message] of [
      ['deployment_failed', 'Deployment failed'],
      ['deployment_content_failed', 'hard links or symlinks'],
      ['deployment_cancelled', 'Deployment cancelled'],
      ['deployment_lost', 'failed to report final status'],
    ]) {
      const { request } = api({
        [`POST ${base}/deployments`]: [created],
        [`GET ${base}/deployments/7`]: [{ status }],
      });
      const error = await rejection(run(request).promise);
      expect(error.message).toContain(message);
      expect(error.message).toContain(status);
    }
  });

  it('cancels the deployment after too many errors reading its status', async () => {
    const { request, calls } = api({
      [`POST ${base}/deployments`]: [created],
      [`GET ${base}/deployments/7`]: [new HttpError(502, 'Bad Gateway')],
      [`POST ${base}/deployments/7/cancel`]: [{}],
    });
    const error = await rejection(run(request, { maxPollErrors: 3 }).promise);
    expect(error.message).toContain('Too many errors');
    expect(
      calls.filter((call) => call === `GET ${base}/deployments/7`).length
    ).toBe(3);
    expect(calls).toContain(`POST ${base}/deployments/7/cancel`);
  });

  it('cancels and fails at once on a permanent error reading the status', async () => {
    const { request, calls } = api({
      [`POST ${base}/deployments`]: [created],
      [`GET ${base}/deployments/7`]: [new HttpError(403, 'Forbidden')],
      [`POST ${base}/deployments/7/cancel`]: [{}],
    });
    const error = await rejection(run(request).promise);
    expect(error.message).toContain('HTTP 403');
    expect(calls).toContain(`POST ${base}/deployments/7/cancel`);
  });

  it('cancels a deployment that does not finish in time', async () => {
    let clock = 0;
    const { request, calls } = api({
      [`POST ${base}/deployments`]: [created],
      [`GET ${base}/deployments/7`]: [{ status: 'deployment_in_progress' }],
      [`POST ${base}/deployments/7/cancel`]: [{}],
    });
    const now = () => (clock += 1000);
    const error = await rejection(
      run(request, { now, timeoutMs: 5000 }).promise
    );
    expect(error.message).toContain('did not finish within 5s');
    expect(calls).toContain(`POST ${base}/deployments/7/cancel`);
  });

  it('reports which deployment it created so a cancelled job can cancel it', async () => {
    const { request } = api({
      [`POST ${base}/deployments`]: [created],
      [`GET ${base}/deployments/7`]: [{ status: 'succeed' }],
    });
    const ids = [];
    await run(request, { onCreated: (id) => ids.push(id) }).promise;
    expect(ids).toEqual([7]);
  });
});

describe('deploy-pages: GitHub clients', () => {
  it('keeps request IDs out of the message and in the description', () => {
    const error = new HttpError(403, 'Forbidden', {
      method: 'POST',
      path: '/x',
      requestId: 'AA00:25F91:3BD2504:C7A75DA:6AE8C500',
      body: '{"message":"Resource not accessible by integration"}',
    });
    expect(error.message).toBe('HTTP 403 Forbidden');
    expect(explain(error)).toContain('request ID AA00:25F91');
    expect(explain(error)).toContain('not accessible by integration');
  });

  it('classifies only 429, 5xx, timeouts and network failures as transient', () => {
    expect(isTransient(http(429))).toBe(true);
    expect(isTransient(http(500))).toBe(true);
    expect(isTransient(http(422))).toBe(false);
    expect(isTransient(new TypeError('fetch failed'))).toBe(true);
    expect(isTransient(new TypeError('x is not a function'))).toBe(false);
    expect(isTransient(new Error('No OIDC token request URL'))).toBe(false);
  });

  it('sends the GitHub headers and raises HTTP errors with their request ID', async () => {
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push({ url, init });
      return new globalThis.Response('{"message":"boom"}', {
        status: 500,
        statusText: 'Internal Server Error',
        headers: { 'x-github-request-id': 'R1' },
      });
    };
    const request = githubApi({ token: 't', fetchImpl });
    const error = await rejection(request('POST', '/p', { a: 1 }));
    expect(error.status).toBe(500);
    expect(error.requestId).toBe('R1');
    expect(error.path).toBe('/p');
    expect(seen[0].url).toBe('https://api.github.com/p');
    expect(seen[0].init.headers.authorization).toBe('Bearer t');
    expect(seen[0].init.body).toBe('{"a":1}');
  });

  it('requests the OIDC token like core.getIDToken', async () => {
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push(init);
      return globalThis.Response.json({ value: 'jwt' });
    };
    const env = {
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'req',
    };
    expect(await oidcToken({ env, fetchImpl })()).toBe('jwt');
    expect(seen[0].headers.authorization).toBe('Bearer req');
    const error = await rejection(oidcToken({ env: {}, fetchImpl })());
    expect(error.message).toContain('id-token: write');
  });

  it('reports a failure as one encoded error annotation', () => {
    expect(annotation(new Error('50% done\nsecond line'))).toBe(
      '::error title=Pages deployment failed::50%25 done%0Asecond line'
    );
  });
});
