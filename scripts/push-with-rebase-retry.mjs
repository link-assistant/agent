/**
 * Push the release commit to main, rebasing onto a main that moved meanwhile.
 *
 * A pull request merged between the release job's checkout and its push made
 * the single `git push origin main` of scripts/version-and-commit.mjs fail the
 * release (issue #337); scripts/rust-version-and-commit.mjs already retried.
 *
 * @param {object} options
 * @param {() => Promise<void>} options.push - rejects when the push fails
 * @param {() => Promise<void>} options.pullRebase - rebases onto origin/main
 * @param {number} [options.attempts]
 * @param {(message: string) => void} [options.log]
 * @returns {Promise<number>} the attempt that succeeded
 */
export async function pushWithRebaseRetry({
  push,
  pullRebase,
  attempts = 3,
  log = console.log,
}) {
  for (let attempt = 1; ; attempt++) {
    try {
      await push();
      return attempt;
    } catch (error) {
      if (attempt >= attempts) {
        throw error;
      }
      log(
        `Push failed (attempt ${attempt}/${attempts}), rebasing onto origin/main and retrying...`
      );
      await pullRebase();
    }
  }
}
