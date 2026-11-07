#!/usr/bin/env node

/**
 * Push HEAD to a branch with bounded recovery for server errors and races.
 *
 *   1. Transient GitHub errors — retry the unchanged ref update three times.
 *   2. Lost race — another main writer pushed first. Rebase onto the new remote
 *      head and push again.
 *   3. Repository rule violation (GH013 / GH006) — the branch refuses direct
 *      pushes. Rebasing can never satisfy a rule, so the same commit is landed
 *      through a pull request for preview updates. Releases fail with explicit
 *      rule configuration guidance (see land-via-pull-request.mjs).
 *
 * Before the GH013 report in link-foundation/js-ai-driven-development-pipeline-template#143 every failure was treated as case 1: under a `pull_request`
 * ruleset both attempts failed, the release job died after the version bump had
 * already been committed in the runner, and the log blamed a race that never
 * happened.
 *
 * Usage:
 *   node scripts/push-main-with-rebase-retry.mjs [remote] [branch] [options]
 *
 * Options:
 *   --label <text>          Label for the fallback pull request (default: package version)
 *   --merge-attempts <n>    Merge polls while GitHub computes mergeability
 *   --merge-delay-ms <ms>   Delay between merge polls
 *
 * Addresses issue:
 * - link-foundation/js-ai-driven-development-pipeline-template#143
 */

import { readFileSync } from 'node:fs';

import { landViaPullRequest } from './land-via-pull-request.mjs';
import {
  isBlockedByRepositoryRule,
  isNonFastForward,
  isTransientPushFailure,
} from './push-failure-classifier.mjs';
import { assertReleaseMetadataOnly } from './release-metadata.mjs';
import { CommandFailedError, runCommand, runStrict } from './run-command.mjs';

/**
 * Parse `[remote] [branch]` positionals plus `--key value` options.
 * @param {string[]} argv
 * @returns {{remote: string, branch: string, options: Record<string, string>}}
 */
export function parseArgs(argv) {
  const positionals = [];
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg.startsWith('--')) {
      const [key, inlineValue] = arg.slice(2).split('=');
      options[key] = inlineValue ?? argv[++index] ?? '';
    } else {
      positionals.push(arg);
    }
  }
  return {
    remote: positionals[0] || 'origin',
    branch: positionals[1] || 'main',
    options,
  };
}

/**
 * Label used for the fallback pull request: the package version when readable,
 * otherwise a generic name. Never fails the push over a missing package.json.
 * @returns {string}
 */
function defaultLabel() {
  try {
    return JSON.parse(readFileSync('package.json', 'utf8')).version;
  } catch {
    return 'automation';
  }
}

/**
 * Push HEAD to `branch`, rebasing on a lost race and falling back to a pull
 * request when a repository rule blocks the direct push.
 * @param {object} options
 * @param {Function} [options.runner]
 * @param {string} [options.remote]
 * @param {string} [options.branch]
 * @param {string} [options.label]
 * @param {number} [options.mergeAttempts]
 * @param {number} [options.mergeDelayMs]
 * @param {Function} [options.sleepFn]
 * @param {Console} [options.logger]
 * @returns {Promise<{pushed: true, via: 'direct'|'rebase'|'pull-request'}>}
 */
export async function pushWithRecovery({
  runner = runCommand,
  remote = 'origin',
  branch = 'main',
  label,
  mergeAttempts,
  mergeDelayMs,
  sleepFn,
  logger = console,
  releaseParent,
}) {
  const pushArgs = ['push', remote, `HEAD:${branch}`];
  const sleep =
    sleepFn || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  // Retrying the same ref update is idempotent, including a lost response.
  // Revalidate release metadata before every attempt and after any rebase.
  const push = async () => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (releaseParent) {
        await assertReleaseMetadataOnly({
          runner,
          parentSha: releaseParent,
          logger,
        });
      }
      const result = await runner('git', pushArgs, { logger });
      if (process.env.CI_SCRIPTS_DEBUG === '1') {
        logger.log(
          `[push] attempt=${attempt} exit=${result.code} rules=${isBlockedByRepositoryRule(result)} transient=${isTransientPushFailure(result)} race=${isNonFastForward(result)}`
        );
      }
      if (
        result.code === 0 ||
        !isTransientPushFailure(result) ||
        attempt === 3
      ) {
        return result;
      }
      logger.log(
        `::notice::GitHub temporarily rejected the push; retrying the same commit (${attempt}/3).`
      );
      await sleep(attempt * 1000);
    }
  };

  const fallback = async (via) => {
    if (releaseParent) {
      throw new Error(
        'Repository rules rejected the release push. Configure the rule to permit github-actions; automated release pull requests are disabled.'
      );
    }
    await landViaPullRequest({
      runner,
      label: label || defaultLabel(),
      branch,
      remote,
      mergeAttempts,
      mergeDelayMs,
      sleepFn,
      logger,
    });
    return { pushed: true, via };
  };

  const first = await push();
  if (first.code === 0) {
    logger.log('Push succeeded.');
    return { pushed: true, via: 'direct' };
  }

  if (isBlockedByRepositoryRule(first)) {
    logger.log(
      `::notice::Push to ${branch} was declined by a repository rule.`
    );
    return fallback('pull-request');
  }

  if (!isNonFastForward(first)) {
    // Auth, network, or anything else a rebase cannot fix: fail with the real
    // error, no misleading retry.
    throw new CommandFailedError('git', pushArgs, first);
  }

  if (releaseParent) {
    throw new Error(
      'Remote main advanced after validation; rerun CI on current main. Release commits cannot be rebased.'
    );
  }

  logger.log(
    `::warning::Initial push failed; rebasing on ${remote}/${branch} before retry.`
  );
  await runStrict('git', ['pull', '--rebase', remote, branch], {
    runner,
    logger,
  });

  const second = await push();
  if (second.code === 0) {
    logger.log('Push succeeded after rebase retry.');
    return { pushed: true, via: 'rebase' };
  }

  // A rule can also appear between the two attempts (a ruleset added mid-run).
  if (isBlockedByRepositoryRule(second)) {
    logger.log(
      `::notice::Push to ${branch} was declined by a repository rule.`
    );
    return fallback('pull-request');
  }

  throw new CommandFailedError('git', pushArgs, second);
}

/**
 * @param {string[]} argv
 * @returns {Promise<void>}
 */
export async function main(argv) {
  const { remote, branch, options } = parseArgs(argv);
  await pushWithRecovery({
    remote,
    branch,
    releaseParent: options['release-parent'],
    label: options.label,
    mergeAttempts: options['merge-attempts']
      ? Number(options['merge-attempts'])
      : undefined,
    mergeDelayMs: options['merge-delay-ms']
      ? Number(options['merge-delay-ms'])
      : undefined,
  });
}

const isDirectRun =
  process.argv[1] &&
  process.argv[1].endsWith('push-main-with-rebase-retry.mjs');

if (isDirectRun) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
