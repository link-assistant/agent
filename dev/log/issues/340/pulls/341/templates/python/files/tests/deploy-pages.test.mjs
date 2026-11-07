// Issue #130: the Pages deploy retries transient failures to create the
// deployment, fails at once on refusals, and never deploys a commit twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  FAILED,
  HttpError,
  TEMPORARY,
  deployPages,
  describe as describeError,
  githubApi,
  isTransient,
  main,
  oidcToken,
} from '../.github/actions/deploy-pages/deploy.mjs';

const SHA = 'a'.repeat(40);
const BASE = '/repos/owner/repo/pages';

function httpError(status, requestId = `REQ-${status}`) {
  return new HttpError(status, `status ${status}`, { method: 'POST', path: `${BASE}/deployments`, requestId });
}

// A scripted Pages API: every call is recorded, and each route answers from
// its own queue (the last answer repeats). An Error answer is thrown.
function mockApi(routes) {
  const calls = [];
  const request = async (method, url, body) => {
    calls.push({ method, url, body });
    const key = `${method} ${url.replace(BASE, '')}`;
    const queue = routes[key];
    if (!queue) throw new Error(`unexpected request ${key}`);
    const answer = queue.length > 1 ? queue.shift() : queue[0];
    if (answer instanceof Error) throw answer;
    return typeof answer === 'function' ? answer(body) : answer;
  };
  return { request, calls };
}

function run(api, overrides = {}) {
  const logs = [];
  const sleeps = [];
  let clock = 0;
  const promise = deployPages({
    request: api.request,
    getIdToken: async () => 'oidc',
    repository: 'owner/repo',
    artifactId: '42',
    buildVersion: SHA,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
    log: (line) => logs.push(line),
    ...overrides,
  });
  return { promise, logs, sleeps };
}

const created = { id: 7, page_url: 'https://owner.github.io/repo/' };
const creations = (calls) => calls.filter((c) => c.method === 'POST' && c.url === `${BASE}/deployments`);

test('creates one deployment of exactly the given artifact and reports its URL', async () => {
  const api = mockApi({
    'POST /deployments': [created],
    'GET /deployments/7': [{ status: 'deployment_queued' }, { status: 'succeed' }],
  });
  const { promise } = run(api);
  assert.deepEqual(await promise, { id: 7, pageUrl: created.page_url });
  assert.deepEqual(creations(api.calls).map((c) => c.body), [
    { artifact_id: 42, pages_build_version: SHA, oidc_token: 'oidc' },
  ]);
});

for (const status of [500, 502, 503, 504, 429]) {
  test(`retries HTTP ${status} from creating the deployment, then succeeds`, async () => {
    const api = mockApi({
      'POST /deployments': [httpError(status), created],
      [`GET /deployments/${SHA}`]: [httpError(404)],
      'GET /deployments/7': [{ status: 'succeed' }],
    });
    const { promise, sleeps, logs } = run(api);
    assert.equal((await promise).id, 7);
    assert.equal(creations(api.calls).length, 2);
    assert.equal(sleeps[0], 10000);
    assert.match(logs.join('\n'), new RegExp(`HTTP ${status}.*REQ-${status}.*retry 2/3`));
  });
}

test('retries a lost connection and a timed-out request', async () => {
  const reset = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('read'), { code: 'ECONNRESET' }) });
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  const api = mockApi({
    'POST /deployments': [reset, timeout, created],
    [`GET /deployments/${SHA}`]: [httpError(404)],
    'GET /deployments/7': [{ status: 'succeed' }],
  });
  const { promise, sleeps } = run(api);
  assert.equal((await promise).id, 7);
  assert.equal(creations(api.calls).length, 3);
  assert.deepEqual(sleeps.slice(0, 2), [10000, 20000]);
});

for (const status of [400, 401, 403, 404, 409, 422]) {
  test(`fails at once on HTTP ${status}, with the status and request ID`, async () => {
    const api = mockApi({ 'POST /deployments': [httpError(status)] });
    const { promise } = run(api);
    await assert.rejects(promise, (error) => {
      assert.match(error.message, new RegExp(`HTTP ${status}`));
      assert.match(error.message, new RegExp(`request ID REQ-${status}`));
      assert.doesNotMatch(error.message, /attempts/);
      return true;
    });
    assert.equal(api.calls.length, 1, 'a refusal is neither retried nor followed by a lookup');
  });
}

test('explains how to fix missing permissions and a disabled Pages site', async () => {
  for (const [status, hint] of [
    [403, /pages: write/],
    [401, /id-token: write/],
    [404, /settings\/pages/],
  ]) {
    const { promise } = run(mockApi({ 'POST /deployments': [httpError(status)] }));
    await assert.rejects(promise, hint);
  }
});

test('gives up after a bounded number of transient failures', async () => {
  const api = mockApi({
    'POST /deployments': [httpError(503)],
    [`GET /deployments/${SHA}`]: [httpError(404)],
  });
  const { promise, sleeps } = run(api);
  await assert.rejects(promise, /after 3 attempts: POST \S+ responded HTTP 503.*request ID REQ-503/);
  assert.equal(creations(api.calls).length, 3);
  assert.deepEqual(sleeps, [10000, 20000]);
});

test('adopts the deployment a lost response created instead of creating another', async () => {
  for (const status of ['deployment_queued', 'deployment_in_progress', 'succeed']) {
    const api = mockApi({
      'POST /deployments': [httpError(502)],
      [`GET /deployments/${SHA}`]: [{ status }, { status: 'succeed' }],
    });
    const { promise, logs } = run(api);
    assert.equal((await promise).id, SHA);
    assert.equal(creations(api.calls).length, 1, `no second deployment while ${status}`);
    assert.match(logs.join('\n'), /Adopted the deployment/);
  }
});

test('replaces an earlier deployment of the commit only when it failed', async () => {
  for (const status of Object.keys(FAILED)) {
    const api = mockApi({
      'POST /deployments': [httpError(500), created],
      [`GET /deployments/${SHA}`]: [{ status }],
      'GET /deployments/7': [{ status: 'succeed' }],
    });
    assert.equal((await run(api).promise).id, 7);
    assert.equal(creations(api.calls).length, 2, status);
  }
});

test('a refused lookup before a retry fails without creating anything', async () => {
  const api = mockApi({
    'POST /deployments': [httpError(500)],
    [`GET /deployments/${SHA}`]: [httpError(403)],
  });
  await assert.rejects(run(api).promise, /HTTP 403/);
  assert.equal(creations(api.calls).length, 1);
});

test('fails with the upstream message for every final deployment state', async () => {
  for (const [status, message] of Object.entries(FAILED)) {
    const api = mockApi({ 'POST /deployments': [created], 'GET /deployments/7': [{ status }] });
    await assert.rejects(run(api).promise, (error) => error.message.endsWith(message));
    assert.ok(!api.calls.some((c) => c.url.endsWith('/cancel')), 'a finished deployment is not cancelled');
  }
});

test('keeps polling through temporary states and status read errors', async () => {
  const api = mockApi({
    'POST /deployments': [{ status_url: `https://api.github.com${BASE}/deployments/99` }],
    'GET ': [{ html_url: 'https://example.test/' }],
    'GET /deployments/99': [
      ...Object.keys(TEMPORARY).map((status) => ({ status })),
      httpError(500),
      httpError(404),
      { status: 'succeed' },
    ],
  });
  const { promise, logs, sleeps } = run(api);
  assert.deepEqual(await promise, { id: '99', pageUrl: 'https://example.test/' });
  for (const message of Object.values(TEMPORARY)) assert.ok(logs.some((line) => line.includes(message)), message);
  assert.deepEqual(sleeps.slice(0, 4), [5000, 7500, 11250, 16875], 'polling backs off by 1.5');
});

test('caps the poll interval at 30 seconds', async () => {
  const api = mockApi({
    'POST /deployments': [created],
    'GET /deployments/7': [...Array(12).fill({ status: 'deployment_in_progress' }), { status: 'succeed' }],
  });
  const { promise, sleeps } = run(api);
  await promise;
  assert.equal(Math.max(...sleeps), 30000);
});

test('cancels the deployment after too many status read errors', async () => {
  const api = mockApi({
    'POST /deployments': [created],
    'GET /deployments/7': [httpError(502)],
    'POST /deployments/7/cancel': [{}],
  });
  await assert.rejects(run(api, { maxPollErrors: 3 }).promise, /Too many errors.*HTTP 502/);
  assert.equal(api.calls.filter((c) => c.url === `${BASE}/deployments/7`).length, 3);
  assert.ok(api.calls.some((c) => c.url === `${BASE}/deployments/7/cancel`));
});

test('cancels the deployment when it does not finish in time', async () => {
  const api = mockApi({
    'POST /deployments': [created],
    'GET /deployments/7': [{ status: 'deployment_in_progress' }],
    'POST /deployments/7/cancel': [httpError(500)],
  });
  const { promise, logs } = run(api, { timeoutMs: 60000 });
  await assert.rejects(promise, /did not finish within 60s/);
  assert.match(logs.join('\n'), /Cancelling deployment 7 failed/);
});

test('refuses a missing or non-numeric artifact ID before calling the API', async () => {
  for (const artifactId of [undefined, '', 'github-pages', '12a']) {
    const api = mockApi({});
    await assert.rejects(run(api, { artifactId }).promise, /artifact ID/);
    assert.equal(api.calls.length, 0);
  }
});

test('classifies only throttling, server errors and lost connections as transient', () => {
  for (const status of [429, 500, 503]) assert.equal(isTransient(httpError(status)), true);
  for (const status of [400, 401, 403, 404, 409, 422]) assert.equal(isTransient(httpError(status)), false);
  // A request ID full of digits must not look like a server error.
  assert.equal(isTransient(new HttpError(404, 'Not Found', { requestId: '500:503' })), false);
  assert.equal(isTransient(new Error('Ensure GITHUB_TOKEN has permission "id-token: write".')), false);
  assert.equal(isTransient(Object.assign(new Error('x'), { code: 'EAI_AGAIN' })), true);
});

function fakeFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const { status = 200, body = '', headers = {} } = responses.shift();
    return new Response(status === 204 ? null : body, { status, statusText: `S${status}`, headers });
  };
  return { fetchImpl, calls };
}

test('githubApi sends an authenticated JSON request and reports the request ID', async () => {
  const { fetchImpl, calls } = fakeFetch([
    { body: '{"id":1}' },
    { status: 500, body: '{"message":"boom"}', headers: { 'x-github-request-id': 'ABCD:1234' } },
  ]);
  const request = githubApi({ token: 'tkn', apiUrl: 'https://api.test', fetchImpl });
  assert.deepEqual(await request('POST', '/x', { a: 1 }), { id: 1 });
  assert.equal(calls[0].url, 'https://api.test/x');
  assert.equal(calls[0].init.headers.authorization, 'Bearer tkn');
  assert.equal(calls[0].init.body, '{"a":1}');
  await assert.rejects(request('GET', '/y'), (error) => {
    assert.equal(error.status, 500);
    assert.equal(error.requestId, 'ABCD:1234');
    assert.equal(describeError(error), 'GET /y responded HTTP 500 S500; request ID ABCD:1234; {"message":"boom"}');
    return true;
  });
});

test('oidcToken requires id-token: write and returns the token', async () => {
  await assert.rejects(oidcToken({ env: {} })(), /id-token: write/);
  const { fetchImpl, calls } = fakeFetch([{ body: '{"value":"jwt"}' }]);
  const env = { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.test/?a=1', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'rt' };
  assert.equal(await oidcToken({ env, fetchImpl })(), 'jwt');
  assert.equal(calls[0].init.headers.authorization, 'Bearer rt');
});

test('main publishes the artifact from INPUT_ARTIFACT_ID and writes page_url', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'deploy-pages-'));
  const output = path.join(dir, 'output');
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    seen.push({ url: String(url), method: init?.method || 'GET', body: init?.body });
    if (String(url).startsWith('https://oidc.test')) return Response.json({ value: 'jwt' });
    if (init.method === 'POST') return Response.json({ id: 5, page_url: 'https://site.test/' });
    return Response.json({ status: 'succeed' });
  });
  await main({
    INPUT_TOKEN: 't',
    INPUT_ARTIFACT_ID: '314',
    GITHUB_API_URL: 'https://api.test',
    GITHUB_REPOSITORY: 'owner/repo',
    GITHUB_SHA: SHA,
    GITHUB_OUTPUT: output,
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.test/',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'rt',
  }, { sleep: async () => {}, log: () => {} }).finally(() => {
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
  });
  const create = seen.find((c) => c.method === 'POST');
  assert.equal(create.url, `https://api.test${BASE}/deployments`);
  assert.deepEqual(JSON.parse(create.body), { artifact_id: 314, pages_build_version: SHA, oidc_token: 'jwt' });
  assert.equal(await readFile(output, 'utf8'), 'page_url=https://site.test/\n');
});
