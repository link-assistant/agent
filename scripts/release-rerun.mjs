/**
 * Decide whether a release job may be finishing an earlier, partly successful
 * attempt.
 *
 * version-and-commit.mjs finds origin/main ahead of its checkout and has no
 * changesets left. In changeset mode that means an earlier attempt already
 * consumed them. Instant mode never has changesets, so the same picture also
 * appears on a first attempt whenever main moved while the quality gates ran;
 * treating that as "already released" ended the run green without a release
 * (#337). Only a rerun (GITHUB_RUN_ATTEMPT > 1) can have pushed a bump.
 *
 * @param {{mode: string, changesetCount: number, runAttempt?: string|number}} options
 * @returns {boolean}
 */
export function isEarlierAttemptRelease({ mode, changesetCount, runAttempt }) {
  if (changesetCount !== 0) {
    return false;
  }
  if (mode !== 'instant') {
    return true;
  }
  return Number(runAttempt || '1') > 1;
}
