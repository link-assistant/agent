/**
 * Helpers for the changeset files in js/.changeset.
 */

import { readdirSync } from 'fs';

/**
 * List pending changeset files (every .md file except README.md).
 * @param {string} dir - The .changeset directory
 * @returns {string[]}
 */
export function listChangesets(dir) {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.md') && file !== 'README.md')
    .sort();
}

/**
 * Throw if `changeset version` left changeset files behind.
 *
 * `changeset version` writes CHANGELOG.md and package.json before it formats
 * them and deletes the consumed changesets. When the formatter cannot run
 * (the 0.26.15 release failed with `spawn bun ENOENT`), the version bump is
 * still on disk, so without this check the release committed it together
 * with the changeset, which then broke the one-changeset check of every
 * later pull request and would be released a second time.
 * @param {string} dir - The .changeset directory
 */
export function assertChangesetsConsumed(dir) {
  const leftover = listChangesets(dir);
  if (leftover.length > 0) {
    throw new Error(
      `changeset version did not consume ${leftover.join(', ')}; ` +
        'refusing to commit a partial version bump'
    );
  }
}
