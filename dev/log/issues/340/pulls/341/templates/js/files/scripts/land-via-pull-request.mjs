/**
 * Land an already-created commit on a branch that refuses direct pushes.
 *
 * When a repository ruleset carries a `pull_request` rule whose `bypass_actors`
 * list does not include the GitHub Actions app, every direct push to `main` is
 * rejected with GH013 ("Changes must be made through a pull request"). The
 * rejection is not a lost race, so the rebase-and-retry recovery cannot help:
 * the release job dies after the version bump has been committed in the runner
 * and the version is never published.
 *
 * The fallback here keeps automation working without weakening the ruleset: the
 * commit is pushed to a short-lived branch, opened as a pull request, and merged
 * through the GitHub API. The local checkout is then fast-forwarded to the
 * merged base branch so the rest of the job (npm publish, GitHub release, ...)
 * proceeds unchanged in the same run.
 *
 * Two common ruleset details shape the implementation:
 *   - a `non_fast_forward` / `deletion` rule targeting `~ALL` forbids force
 *     pushes and branch deletion on every ref, so the temporary branch is never
 *     force-pushed and never deleted; the run id makes each attempt's name
 *     unique instead.
 *   - `allowed_merge_methods` may be `["merge"]` only, so the merge must not
 *     assume squash or rebase.
 *   - pull requests opened with the workflow's built-in `GITHUB_TOKEN` do not
 *     start ordinary `pull_request` checks. The helper attests a metadata-only
 *     release commit with the parent workflow's validation check instead.
 *
 * Addresses issue:
 * - link-foundation/js-ai-driven-development-pipeline-template#143
 * - link-foundation/js-ai-driven-development-pipeline-template#192
 */

import { CommandFailedError, runCommand, runStrict } from './run-command.mjs';
import { assertReleaseMetadataOnly } from './release-metadata.mjs';

export const DEFAULT_MERGE_ATTEMPTS = 10;
export const DEFAULT_MERGE_DELAY_MS = 5000;
export const DEFAULT_CHECK_DISCOVERY_ATTEMPTS = 10;
export const DEFAULT_CHECK_DISCOVERY_DELAY_MS = 5000;

function readEnv(name) {
  try {
    return process.env[name] || '';
  } catch {
    return '';
  }
}

/**
 * Default sleep implementation (injectable so tests do not wait).
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

/**
 * Name of the temporary branch that carries the commit into a pull request.
 *
 * The run id is embedded because a `no destruction` style rule blocks both
 * force pushes and branch deletion: a reused name could neither be updated nor
 * cleaned up, so every attempt gets a fresh ref.
 * @param {{label?: string, runId?: string, prefix?: string}} options
 * @returns {string}
 */
export function pullRequestBranchName({
  label = 'automation',
  runId,
  prefix = 'release',
} = {}) {
  const slug = String(label)
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return [prefix, [slug || 'automation', runId].filter(Boolean).join('-')].join(
    '/'
  );
}

/**
 * URL of an open pull request for a head branch, or '' when none exists.
 * @param {object} options
 * @param {Function} options.runner
 * @param {string} options.head
 * @param {string} options.base
 * @param {object} [options.env]
 * @param {Console} [options.logger]
 * @returns {Promise<string>}
 */
export async function findOpenPullRequest({
  runner,
  head,
  base,
  env,
  logger = console,
}) {
  const result = await runner(
    'gh',
    [
      'pr',
      'list',
      '--head',
      head,
      '--base',
      base,
      '--state',
      'open',
      '--json',
      'url',
      '--jq',
      '.[0].url // ""',
    ],
    { env, logger }
  );
  return result.code === 0 ? (result.stdout || '').trim() : '';
}

/**
 * Whether a failed merge is the short mergeability-computation race that is
 * safe to retry. Policy, authentication, and failed-check errors are invariant
 * for this attempt and must be returned immediately.
 * @param {{stdout?: string, stderr?: string}} result
 * @returns {boolean}
 */
export function isTransientMergeFailure(result) {
  const output = `${result.stderr || ''}\n${result.stdout || ''}`;
  return /pull request is not mergeable|mergeability is still being calculated/i.test(
    output
  );
}

/**
 * Merge a pull request, retrying while GitHub is still computing mergeability.
 *
 * `gh pr merge` fails with "Pull request is not mergeable" for a few seconds
 * after creation, while the `mergeable` field is still null. Treating that
 * transient state as a hard failure aborts a release one poll away from
 * success.
 * @param {object} options
 * @param {Function} options.runner
 * @param {string} options.url
 * @param {number} [options.maxAttempts]
 * @param {number} [options.delayMs]
 * @param {Function} [options.sleepFn]
 * @param {object} [options.env]
 * @param {Console} [options.logger]
 * @returns {Promise<{merged: true, attempt: number}>}
 */
export async function mergePullRequestWithRetry({
  runner,
  url,
  maxAttempts = DEFAULT_MERGE_ATTEMPTS,
  delayMs = DEFAULT_MERGE_DELAY_MS,
  sleepFn = sleep,
  env,
  logger = console,
}) {
  // `--merge` only: allowed_merge_methods may exclude squash and rebase.
  const args = ['pr', 'merge', url, '--merge'];
  let last = { code: 1, stdout: '', stderr: '' };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = await runner('gh', args, { env, logger });
    if (last.code === 0) {
      return { merged: true, attempt };
    }
    if (!isTransientMergeFailure(last) || attempt === maxAttempts) {
      break;
    }
    logger.log(
      `Merge attempt ${attempt} of ${maxAttempts} did not succeed yet; GitHub may still be computing mergeability. Retrying...`
    );
    await sleepFn(delayMs);
  }

  throw new CommandFailedError('gh', args, last);
}

/**
 * Wait for the checks attached to the pull request itself. Immediately after
 * creation GitHub can briefly report no checks; only that discovery race is
 * retried. Once checks exist, `gh pr checks --watch --fail-fast` waits for
 * completion and returns a real failed check without a merge attempt.
 * @param {object} options
 * @param {Function} options.runner
 * @param {string} options.url
 * @param {number} [options.maxAttempts]
 * @param {number} [options.delayMs]
 * @param {Function} [options.sleepFn]
 * @param {object} [options.env]
 * @param {Console} [options.logger]
 * @returns {Promise<{passed: true, attempt: number}>}
 */
export async function waitForPullRequestChecks({
  runner,
  url,
  maxAttempts = DEFAULT_CHECK_DISCOVERY_ATTEMPTS,
  delayMs = DEFAULT_CHECK_DISCOVERY_DELAY_MS,
  sleepFn = sleep,
  env,
  logger = console,
}) {
  const args = ['pr', 'checks', url, '--required', '--watch', '--fail-fast'];
  let last = { code: 1, stdout: '', stderr: '' };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = await runner('gh', args, { env, logger });
    if (last.code === 0) {
      return { passed: true, attempt };
    }

    const output = `${last.stderr || ''}\n${last.stdout || ''}`;
    if (
      !/no (required )?checks reported/i.test(output) ||
      attempt === maxAttempts
    ) {
      break;
    }

    logger.log(
      `No pull-request checks discovered yet (attempt ${attempt} of ${maxAttempts}); retrying...`
    );
    await sleepFn(delayMs);
  }

  throw new CommandFailedError('gh', args, last);
}

/** Publish the parent run's successful validation on the exact release SHA. */
export async function createReleaseValidationCheck({
  runner,
  repository,
  headSha,
  runUrl,
  env,
  logger = console,
}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '')) {
    throw new Error('GITHUB_REPOSITORY is required for release attestation.');
  }
  if (!/^[0-9a-f]{40}$/i.test(headSha || '')) {
    throw new Error('A valid release commit SHA is required for attestation.');
  }
  if (!/^https:\/\//.test(runUrl || '')) {
    throw new Error('A parent workflow run URL is required for attestation.');
  }
  await runStrict(
    'gh',
    [
      'api',
      '--method',
      'POST',
      `repos/${repository}/check-runs`,
      '-f',
      'name=Pipeline Status',
      '-f',
      `head_sha=${headSha}`,
      '-f',
      'status=completed',
      '-f',
      'conclusion=success',
      '-f',
      `details_url=${runUrl}`,
      '-f',
      'output[title]=Validated by the parent release workflow',
      '-f',
      'output[summary]=All applicable pre-release validation jobs passed on the parent commit. This generated commit changes only allowed release metadata, so its source tree is the validated parent source tree.',
    ],
    { runner, env, logger }
  );
}

/**
 * Default body for the fallback pull request.
 * @param {string} label
 * @param {string} base
 * @returns {string}
 */
function defaultBody(label, base) {
  return [
    `Automated change (\`${label}\`) landed through a pull request.`,
    '',
    `A repository ruleset requires every change to \`${base}\` to go through a`,
    'pull request, so this workflow opens and merges this pull request instead',
    'of pushing directly.',
    '',
    'See link-foundation/js-ai-driven-development-pipeline-template#143 and #192.',
  ].join('\n');
}

/**
 * Reuse the pull request for this run, or create it when this is the first
 * landing attempt.
 * @param {object} options
 * @returns {Promise<string>}
 */
async function findOrCreatePullRequest({
  runner,
  strict,
  head,
  branch,
  title,
  label,
  body,
  env,
  logger,
}) {
  const existing = await findOpenPullRequest({
    runner,
    head,
    base: branch,
    env,
    logger,
  });
  if (existing) {
    logger.log(`Reusing existing pull request ${existing}`);
    return existing;
  }

  const created = await strict(
    'gh',
    [
      'pr',
      'create',
      '--base',
      branch,
      '--head',
      head,
      '--title',
      title || label,
      '--body',
      body || defaultBody(label, branch),
    ],
    { env }
  );
  const url =
    (created.stdout || '').trim().split('\n').filter(Boolean).pop() || head;
  logger.log(`Created pull request ${url}`);
  return url;
}

/**
 * Push HEAD to a temporary branch, open a pull request, merge it, and
 * fast-forward the local checkout to the merged base branch.
 * @param {object} options
 * @param {Function} [options.runner]
 * @param {string} [options.label] - Human-readable label (e.g. the new version)
 * @param {string} [options.branch] - Base branch
 * @param {string} [options.remote]
 * @param {string} [options.runId]
 * @param {string} [options.title]
 * @param {string} [options.body]
 * @param {number} [options.mergeAttempts]
 * @param {number} [options.mergeDelayMs]
 * @param {number} [options.checkAttempts]
 * @param {number} [options.checkDelayMs]
 * @param {string} [options.releasePullRequestToken]
 * @param {Function} [options.sleepFn]
 * @param {Console} [options.logger]
 * @returns {Promise<{landed: true, head: string, url: string}>}
 */
function defaultRunUrl(repository) {
  const server = readEnv('GITHUB_SERVER_URL');
  const runId = readEnv('GITHUB_RUN_ID');
  return server && runId && repository
    ? `${server}/${repository}/actions/runs/${runId}`
    : '';
}

function resolveLandingOptions(options) {
  const defaults = {
    runner: runCommand,
    label: 'automation',
    branch: 'main',
    remote: 'origin',
    runId: readEnv('GITHUB_RUN_ID'),
    mergeAttempts: DEFAULT_MERGE_ATTEMPTS,
    mergeDelayMs: DEFAULT_MERGE_DELAY_MS,
    checkAttempts: DEFAULT_CHECK_DISCOVERY_ATTEMPTS,
    checkDelayMs: DEFAULT_CHECK_DISCOVERY_DELAY_MS,
    releasePullRequestToken: readEnv('RELEASE_PR_TOKEN'),
    githubToken: readEnv('GITHUB_TOKEN'),
    repository: readEnv('GITHUB_REPOSITORY'),
    parentSha: readEnv('GITHUB_SHA'),
    metadataPaths: readEnv('RELEASE_METADATA_PATHS'),
    sleepFn: sleep,
    logger: console,
  };
  const resolved = { ...defaults, ...options };
  for (const [key, value] of Object.entries(defaults)) {
    if (resolved[key] === undefined) {
      resolved[key] = value;
    }
  }
  if (resolved.runUrl === undefined) {
    resolved.runUrl = defaultRunUrl(resolved.repository);
  }
  return resolved;
}

export async function landViaPullRequest(options = {}) {
  const {
    runner,
    label,
    branch,
    remote,
    runId,
    title,
    body,
    mergeAttempts,
    mergeDelayMs,
    checkAttempts,
    checkDelayMs,
    releasePullRequestToken,
    githubToken,
    repository,
    parentSha,
    runUrl,
    metadataPaths,
    sleepFn,
    logger,
  } = resolveLandingOptions(options);
  const dedicatedToken = releasePullRequestToken?.trim();
  const token = dedicatedToken || githubToken?.trim();
  if (!token) {
    throw new Error(
      'RELEASE_PR_TOKEN or GITHUB_TOKEN is required to open a protected release pull request.'
    );
  }

  // The built-in token cannot trigger ordinary PR workflows. Its check is
  // valid only when the generated commit is a child of the validated SHA and
  // changes nothing outside release metadata. Check before pushing the ref.
  const headSha = dedicatedToken
    ? ''
    : await assertReleaseMetadataOnly({
        runner,
        parentSha,
        extraPaths: metadataPaths,
        logger,
      });
  const ghEnv = { GH_TOKEN: token };
  const strict = (command, args, options = {}) =>
    runStrict(command, args, { runner, logger, ...options });
  const head = pullRequestBranchName({ label, runId });

  logger.log(
    `Direct push to ${branch} is blocked by a repository rule. Landing "${label}" through a pull request instead.`
  );
  logger.log(`Pushing commit to ${remote}/${head}...`);
  await strict('git', ['push', remote, `HEAD:refs/heads/${head}`]);

  const url = await findOrCreatePullRequest({
    runner,
    strict,
    head,
    branch,
    title,
    label,
    body,
    env: ghEnv,
    logger,
  });

  if (!dedicatedToken) {
    await createReleaseValidationCheck({
      runner,
      repository,
      headSha,
      runUrl,
      env: ghEnv,
      logger,
    });
  }

  await waitForPullRequestChecks({
    runner,
    url,
    maxAttempts: checkAttempts,
    delayMs: checkDelayMs,
    sleepFn,
    env: ghEnv,
    logger,
  });
  logger.log(`Required checks passed for pull request ${url}.`);

  await mergePullRequestWithRetry({
    runner,
    url,
    maxAttempts: mergeAttempts,
    delayMs: mergeDelayMs,
    sleepFn,
    env: ghEnv,
    logger,
  });
  logger.log(`Pull request ${url} merged into ${branch}.`);

  // Fast-forward the local checkout so later steps in the same job operate on
  // the tree that is now on the base branch.
  await strict('git', ['fetch', remote, branch]);
  await strict('git', ['reset', '--hard', `${remote}/${branch}`]);

  return { landed: true, head, url };
}
