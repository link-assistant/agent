#!/usr/bin/env node
/**
 * Publish the Pages artifact with the REST protocol of actions/deploy-pages@v5
 * (create a deployment with an OIDC token, poll it, cancel it when abandoned),
 * and retry what that action does not: a transient failure to create the
 * deployment.
 *
 * - HTTP 429, 5xx and network failures of `POST .../pages/deployments` are
 *   retried a bounded number of times with a growing delay.
 * - A permanent refusal (any other 4xx) fails on the first attempt, with the
 *   status and the GitHub request ID.
 * - Before every retry the deployment of this commit is looked up. A lost
 *   response may hide a deployment that was created; it is adopted unless it
 *   already failed, so a retry never races a second deployment of one commit.
 * - The deployment is polled until a final state, and cancelled on timeout,
 *   on too many polling errors, or when the job is cancelled.
 *
 * It uses only `fetch` (through ./github-api.mjs), so the deploy job installs
 * no npm dependencies.
 */
import { appendFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { HttpError, describe, githubApi, isTransient } from './github-api.mjs';

export { HttpError, describe, githubApi, isTransient };

export const SUCCEEDED = 'succeed';

/** The final states of actions/deploy-pages; any other state is in progress. */
export const FAILED = {
  deployment_failed: 'Deployment failed, try again later.',
  deployment_content_failed:
    'Artifact could not be deployed. Ensure it has no hard links or symlinks and is smaller than 10 GB.',
  deployment_cancelled: 'Deployment cancelled.',
  deployment_lost: 'Deployment failed to report final status.',
};

/** The request core.getIDToken() of @actions/core makes, without audience. */
export function oidcToken({ env = process.env, fetchImpl = fetch } = {}) {
  return async () => {
    const url = env.ACTIONS_ID_TOKEN_REQUEST_URL;
    const token = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    if (!url || !token) {
      throw new Error(
        'No OIDC token request URL: grant the deploy job "id-token: write".'
      );
    }
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      throw new HttpError(response.status, response.statusText, {
        method: 'GET',
        path: 'OIDC token request',
        requestId: response.headers?.get?.('x-github-request-id'),
      });
    }
    const { value } = await response.json();
    if (!value) {
      throw new Error('The OIDC token response has no token.');
    }
    return value;
  };
}

/**
 * The deployment of `buildVersion` a retry adopts so that it does not create
 * another one: any that exists and has not reached a failed state.
 */
async function existingDeployment(request, base, buildVersion) {
  try {
    const found = await request('GET', `${base}/deployments/${buildVersion}`);
    return found?.status && !FAILED[found.status]
      ? { ...found, id: buildVersion }
      : null;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

async function createDeployment(options, attempt) {
  const { request, base, getIdToken, artifactId, buildVersion, log } = options;
  if (attempt > 1) {
    const adopted = await existingDeployment(request, base, buildVersion);
    if (adopted) {
      log(
        `Adopted the deployment of ${buildVersion} that an earlier attempt created (status ${adopted.status}).`
      );
      return adopted;
    }
  }
  const created = await request('POST', `${base}/deployments`, {
    artifact_id: Number(artifactId),
    pages_build_version: buildVersion,
    oidc_token: await getIdToken(),
  });
  log(
    `Created the Pages deployment of ${buildVersion} from artifact ${artifactId} (attempt ${attempt}/${options.attempts}).`
  );
  return created;
}

async function createWithRetry(options) {
  const { attempts, retryDelayMs, sleep, log } = options;
  for (let attempt = 1; ; attempt++) {
    try {
      return await createDeployment(options, attempt);
    } catch (error) {
      if (!isTransient(error) || attempt >= attempts) {
        throw new Error(
          `Creating the Pages deployment failed after ${attempt} attempt(s): ${describe(error)}`,
          { cause: error }
        );
      }
      const wait = attempt * retryDelayMs;
      log(
        `Transient failure to create the Pages deployment (${describe(error)}); retrying in ${wait / 1000}s (${attempt}/${attempts}).`
      );
      await sleep(wait);
    }
  }
}

export async function cancel(request, base, id, log = console.log) {
  try {
    await request('POST', `${base}/deployments/${id}/cancel`);
    log(`Cancelled Pages deployment ${id}.`);
  } catch (error) {
    log(`Cancelling Pages deployment ${id} failed: ${describe(error)}`);
  }
}

async function pollUntilFinal(options, id, pageUrl) {
  const { request, base, pollIntervalMs, maxPollErrors, timeoutMs } = options;
  const { sleep, now, log } = options;
  const start = now();
  let errors = 0;
  for (;;) {
    await sleep(pollIntervalMs);
    let status;
    try {
      ({ status } = await request('GET', `${base}/deployments/${id}`));
    } catch (error) {
      if (!isTransient(error)) {
        await cancel(request, base, id, log);
        throw new Error(
          `Reading the Pages deployment status failed: ${describe(error)}`,
          { cause: error }
        );
      }
      if (++errors >= maxPollErrors) {
        await cancel(request, base, id, log);
        throw new Error(
          `Too many errors reading the Pages deployment status: ${describe(error)}`,
          { cause: error }
        );
      }
      log(
        `Transient failure to read the deployment status (${describe(error)}); ${errors}/${maxPollErrors}.`
      );
    }
    if (status === SUCCEEDED) {
      log(`Pages deployment ${id} succeeded: ${pageUrl}`);
      return;
    }
    if (FAILED[status]) {
      throw new Error(`Pages deployment ${id}: ${FAILED[status]} (${status})`);
    }
    if (status) {
      log(`Pages deployment ${id}: ${status}`);
    }
    if (now() - start >= timeoutMs) {
      await cancel(request, base, id, log);
      throw new Error(
        `Pages deployment ${id} did not finish within ${timeoutMs / 1000}s.`
      );
    }
  }
}

function validate({ artifactId, buildVersion, repository }) {
  if (!/^\d+$/.test(String(artifactId ?? ''))) {
    throw new Error(
      `Missing Pages artifact ID: "${artifactId ?? ''}". Pass the artifact-id output of the upload step.`
    );
  }
  if (!buildVersion) {
    throw new Error('Missing build version (the commit SHA).');
  }
  if (!repository) {
    throw new Error('Missing repository (owner/name).');
  }
}

/**
 * Create (or adopt) the deployment of one commit and wait for its result.
 * @returns {Promise<{id: string|number, pageUrl: string}>}
 */
export async function deployPages({
  request,
  getIdToken,
  repository,
  artifactId,
  buildVersion,
  attempts = 3,
  retryDelayMs = 10000,
  pollIntervalMs = 5000,
  maxPollErrors = 10,
  timeoutMs = 600000,
  sleep = delay,
  now = Date.now,
  log = console.log,
  onCreated = () => {},
}) {
  validate({ artifactId, buildVersion, repository });
  const options = {
    request,
    getIdToken,
    artifactId,
    buildVersion,
    attempts,
    retryDelayMs,
    pollIntervalMs,
    maxPollErrors,
    timeoutMs,
    sleep,
    now,
    log,
    base: `/repos/${repository}/pages`,
  };
  const deployment = await createWithRetry(options);
  const id =
    deployment.id || deployment.status_url?.split('/').pop() || buildVersion;
  onCreated(id);
  const pageUrl =
    deployment.page_url ||
    (await request('GET', options.base).catch(() => ({}))).html_url ||
    '';
  await pollUntilFinal(options, id, pageUrl);
  return { id, pageUrl };
}

/** Escape text for the data part of a workflow command. */
export function annotation(error) {
  const text = String(error?.message || error)
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A');
  return `::error title=Pages deployment failed::${text}`;
}

export async function main(env = process.env) {
  const request = githubApi({
    token: env.GITHUB_TOKEN,
    apiUrl: env.GITHUB_API_URL || undefined,
  });
  const base = `/repos/${env.GITHUB_REPOSITORY}/pages`;
  let pending = null;
  // A cancelled job must not leave a deployment that blocks the next one.
  const abandon = async () => {
    if (pending) {
      await cancel(request, base, pending);
    }
    process.exit(1);
  };
  process.once('SIGINT', abandon);
  process.once('SIGTERM', abandon);
  const { pageUrl } = await deployPages({
    request,
    getIdToken: oidcToken({ env }),
    repository: env.GITHUB_REPOSITORY,
    artifactId: env.ARTIFACT_ID,
    buildVersion: env.GITHUB_SHA,
    onCreated: (id) => {
      pending = id;
    },
  });
  pending = null;
  if (env.GITHUB_OUTPUT) {
    appendFileSync(env.GITHUB_OUTPUT, `page_url=${pageUrl}\n`);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.log(annotation(error));
    process.exitCode = 1;
  });
}
