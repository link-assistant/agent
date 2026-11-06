// Publishes a Pages artifact with the REST protocol of actions/deploy-pages@v5:
// create a deployment with an OIDC token, poll it, cancel it when abandoned.
// Unlike v5 it retries a transient failure to create the deployment (issue #130):
// one HTTP 500 from POST /pages/deployments otherwise fails main although the
// site, the tests and the artifact are fine. Permanent refusals (4xx except 429)
// fail on the first attempt with the status and the request ID.
//
// Only Node.js built-ins are used, so there is no bundle to rebuild and no
// bundled punycode module raising DEP0040 (actions/deploy-pages#434).
import { appendFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

export const SUCCEEDED = 'succeed';

// Final states of actions/deploy-pages v5; messages match upstream.
export const FAILED = {
  deployment_failed: 'Deployment failed, try again later.',
  deployment_content_failed:
    'Artifact could not be deployed. Please ensure the content does not contain any hard links, symlinks and total size is less than 10GB.',
  deployment_cancelled: 'Deployment cancelled.',
  deployment_lost: 'Deployment failed to report final status.',
};

// Reported while polling; the deployment may still finish.
export const TEMPORARY = {
  unknown_status: 'Unable to get deployment status.',
  not_found: 'Deployment not found.',
  deployment_attempt_error: 'Deployment temporarily failed, a retry will be automatically scheduled...',
};

export class HttpError extends Error {
  constructor(status, statusText, { method, path, requestId, body } = {}) {
    super(`HTTP ${status}${statusText ? ` ${statusText}` : ''}`);
    Object.assign(this, { name: 'HttpError', status, method, path, requestId, body });
  }
}

const NETWORK =
  /\b(?:ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|EPIPE|UND_ERR_[A-Z_]+)\b|socket hang up|fetch failed|other side closed/i;

// Retry only what a later attempt can fix: HTTP 429/5xx and lost connections.
export function isTransient(error) {
  if (error instanceof HttpError) return error.status === 429 || error.status >= 500;
  for (let item = error, depth = 0; item && depth < 8; item = item.cause, depth++) {
    if (item.name === 'TimeoutError' || NETWORK.test(`${item.code || ''} ${item.message || ''}`)) return true;
  }
  return false;
}

export function describe(error) {
  if (!(error instanceof HttpError)) return error?.message || String(error);
  const detail = [`${error.method} ${error.path} responded ${error.message}`];
  if (error.requestId) detail.push(`request ID ${error.requestId}`);
  const body = String(error.body || '').trim();
  if (body) detail.push(body.slice(0, 300));
  return detail.join('; ');
}

// What the person reading the failed run should do about a refusal.
function hint(error, { serverUrl, repository }) {
  if (!(error instanceof HttpError)) return '';
  if (error.status === 401 || error.status === 403) return ' Ensure the job grants "pages: write" and "id-token: write".';
  if (error.status === 404)
    return ` Ensure GitHub Pages is enabled with Source "GitHub Actions": ${serverUrl}/${repository}/settings/pages`;
  if (error.status >= 500 || error.status === 429)
    return ' Server error, is githubstatus.com reporting a Pages outage? Re-run the deployment later.';
  return '';
}

export function githubApi({ token, apiUrl = 'https://api.github.com', fetchImpl = fetch, timeoutMs = 30000 }) {
  if (!token) throw new Error('No token: pass the "token" input or run inside GitHub Actions.');
  return async (method, path, body) => {
    const response = await fetchImpl(`${apiUrl}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'deploy-pages-with-retries',
        'x-github-api-version': '2022-11-28',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    if (!response.ok)
      throw new HttpError(response.status, response.statusText, {
        method,
        path,
        requestId: response.headers.get('x-github-request-id'),
        body: text,
      });
    return text ? JSON.parse(text) : {};
  };
}

// The request core.getIDToken() of @actions/toolkit makes, without an audience.
export function oidcToken({ env = process.env, fetchImpl = fetch } = {}) {
  return async () => {
    const url = env.ACTIONS_ID_TOKEN_REQUEST_URL;
    const token = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    if (!url || !token) throw new Error('Ensure GITHUB_TOKEN has permission "id-token: write".');
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new HttpError(response.status, response.statusText, {
        method: 'GET',
        path: 'OIDC token request',
        requestId: response.headers.get('x-github-request-id'),
      });
    const { value } = await response.json();
    if (!value) throw new Error('The OIDC token response has no token.');
    return value;
  };
}

export async function deployPages({
  request,
  getIdToken,
  repository,
  artifactId,
  buildVersion,
  serverUrl = 'https://github.com',
  attempts = 3,
  retryDelayMs = 10000,
  pollIntervalMs = 5000,
  maxPollIntervalMs = 30000,
  maxPollErrors = 10,
  timeoutMs = 600000,
  sleep = delay,
  now = Date.now,
  log = console.log,
  onCreated = () => {},
}) {
  if (!/^\d+$/.test(String(artifactId ?? '')))
    throw new Error(`Missing or invalid Pages artifact ID "${artifactId ?? ''}": pass the build job's artifact-id output.`);
  if (!buildVersion) throw new Error('Missing build version (the commit SHA).');
  const base = `/repos/${repository}/pages`;
  let deployment;
  for (let attempt = 1; !deployment; attempt++) {
    try {
      // A lost response may hide a deployment that was created. Adopt it unless
      // it already failed, so a retry never deploys the same commit twice.
      if (attempt > 1) deployment = await existingDeployment(request, base, buildVersion);
      if (deployment) log(`Adopted the deployment of ${buildVersion} that attempt ${attempt - 1} created.`);
      else {
        deployment = await request('POST', `${base}/deployments`, {
          artifact_id: Number(artifactId),
          pages_build_version: buildVersion,
          oidc_token: await getIdToken(),
        });
        log(`Created the deployment of ${buildVersion} from artifact ${artifactId} (attempt ${attempt}/${attempts}).`);
      }
    } catch (error) {
      if (!isTransient(error) || attempt >= attempts) {
        const tried = isTransient(error) ? ` after ${attempts} attempts` : '';
        throw new Error(
          `Failed to create the Pages deployment of ${buildVersion}${tried}: ${describe(error)}.${hint(error, { serverUrl, repository })}`,
          { cause: error },
        );
      }
      const wait = attempt * retryDelayMs;
      log(`Transient failure to create the deployment (${describe(error)}); retry ${attempt + 1}/${attempts} in ${wait / 1000}s.`);
      await sleep(wait);
    }
  }
  const id = deployment.id || deployment.status_url?.split('/').pop() || buildVersion;
  onCreated(id);
  const pageUrl = deployment.page_url || (await pagesUrl(request, base, log));
  const start = now();
  let interval = pollIntervalMs;
  let errors = 0;
  for (;;) {
    await sleep(interval);
    let status;
    try {
      ({ status } = await request('GET', `${base}/deployments/${id}`));
    } catch (error) {
      // As in v5, any failed status read counts towards the error budget.
      if (++errors >= maxPollErrors) {
        await cancel(request, base, id, log);
        throw new Error(`Too many errors reading the status of deployment ${id}: ${describe(error)}`, { cause: error });
      }
      log(`Failed to read the status of deployment ${id} (${describe(error)}); error ${errors}/${maxPollErrors}.`);
    }
    if (status === SUCCEEDED) {
      log(`Deployment ${id} succeeded: ${pageUrl}`);
      return { id, pageUrl };
    }
    if (FAILED[status]) throw new Error(`Deployment ${id}: ${FAILED[status]}`);
    if (status) {
      log(`Deployment ${id}: ${TEMPORARY[status] || `current status ${status}`}`);
      interval = Math.min(Math.round(interval * 1.5), Math.max(maxPollIntervalMs, pollIntervalMs));
    }
    if (now() - start >= timeoutMs) {
      await cancel(request, base, id, log);
      throw new Error(`Deployment ${id} did not finish within ${timeoutMs / 1000}s and was cancelled.`);
    }
  }
}

async function existingDeployment(request, base, buildVersion) {
  try {
    const found = await request('GET', `${base}/deployments/${buildVersion}`);
    return found?.status && !FAILED[found.status] ? { ...found, id: found.id || buildVersion } : null;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}

// The page URL is only reported, so a failure to read it must not fail the deployment.
async function pagesUrl(request, base, log) {
  try {
    return (await request('GET', base)).html_url || '';
  } catch (error) {
    log(`Could not read the Pages URL: ${describe(error)}`);
    return '';
  }
}

export async function cancel(request, base, id, log = console.log) {
  try {
    await request('POST', `${base}/deployments/${id}/cancel`);
    log(`Cancelled deployment ${id}.`);
  } catch (error) {
    log(`Cancelling deployment ${id} failed: ${describe(error)}`);
  }
}

// `options` reach deployPages, so tests can replace the clock.
export async function main(env = process.env, options = {}) {
  const request = githubApi({ token: env.INPUT_TOKEN || env.GITHUB_TOKEN, apiUrl: env.GITHUB_API_URL });
  const base = `/repos/${env.GITHUB_REPOSITORY}/pages`;
  let pending = null;
  // A cancelled workflow must not leave a deployment that blocks the next one.
  const abandon = async () => {
    if (pending) await cancel(request, base, pending);
    process.exit(1);
  };
  process.once('SIGINT', abandon);
  process.once('SIGTERM', abandon);
  const { pageUrl } = await deployPages({
    request,
    getIdToken: oidcToken({ env }),
    repository: env.GITHUB_REPOSITORY,
    artifactId: env.INPUT_ARTIFACT_ID,
    buildVersion: env.GITHUB_SHA,
    serverUrl: env.GITHUB_SERVER_URL,
    onCreated: (id) => (pending = id),
    ...options,
  });
  pending = null;
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `page_url=${pageUrl}\n`);
}

// One error annotation per failure, encoded as a workflow command message.
export function fail(error) {
  const text = String(error?.message || error)
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
  console.log(`::error::${text}`);
  process.exitCode = 1;
}
