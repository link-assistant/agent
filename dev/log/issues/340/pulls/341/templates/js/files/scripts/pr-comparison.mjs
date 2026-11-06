import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Resolve both commits before comparing; a failed lookup must never pass CI. */
export function getPrComparison(env = process.env) {
  const baseRef =
    env.GITHUB_BASE_SHA ||
    env.BASE_SHA ||
    `refs/remotes/origin/${env.GITHUB_BASE_REF || 'main'}`;
  const headRef = env.GITHUB_HEAD_SHA || env.HEAD_SHA || 'HEAD';
  const resolve = (ref) =>
    git([
      'rev-parse',
      '--verify',
      '--end-of-options',
      `${ref}^{commit}`,
    ]).trim();
  const base = resolve(baseRef);
  const head = resolve(headRef);
  const mergeBase = git(['merge-base', base, head]).trim();
  if (!mergeBase) {
    throw new Error('No PR merge base is available');
  }
  if (env.DEBUG) {
    console.log(
      `PR comparison: ${baseRef} (${base}), ${headRef} (${head}), merge base ${mergeBase}`
    );
  }
  return { mergeBase, head };
}

export function getPrChanges(comparison) {
  const fields = git([
    'diff',
    '--name-status',
    '-z',
    '--find-renames=100%',
    comparison.mergeBase,
    comparison.head,
    '--',
  ]).split('\0');
  const changes = [];
  for (let index = 0; index < fields.length - 1; ) {
    const status = fields[index++];
    const path = fields[index++];
    // Exact moves are not additions, but both paths still affect package code.
    if (/^[RC]/.test(status)) {
      changes.push({ status, oldPath: path, path: fields[index++] });
    } else {
      changes.push({ status, path });
    }
  }
  if (process.env.DEBUG) {
    console.log('PR changes (exact rename detection):', changes);
  }
  return changes;
}

/** A branch name alone cannot grant an exemption from release guards. */
export function isTrustedReleasePr(env = process.env) {
  if (!env.GITHUB_EVENT_PATH || !env.GITHUB_REPOSITORY) {
    return false;
  }
  const { pull_request: pr } = JSON.parse(
    readFileSync(env.GITHUB_EVENT_PATH, 'utf8')
  );
  const actor = env.RELEASE_PR_ACTOR || 'github-actions[bot]';
  const { user, head, base } = pr || {};
  return Boolean(
    user?.login === actor &&
    [head, base].every(
      (side) => side?.repo?.full_name === env.GITHUB_REPOSITORY
    ) &&
    /^(changeset-release\/|changeset-manual-release-|release\/)/.test(
      head?.ref || ''
    )
  );
}
