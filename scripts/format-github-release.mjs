#!/usr/bin/env node

/**
 * Format GitHub release notes using the format-release-notes.mjs script
 * Usage: node scripts/format-github-release.mjs --release-version <version> --repository <repository> --commit-sha <commit_sha>
 *   release-version: Version number (e.g., 1.0.0)
 *   repository: GitHub repository (e.g., owner/repo)
 *   commit_sha: Commit SHA for PR detection
 *
 * Uses link-foundation libraries:
 * - command-stream: Modern shell command execution with streaming support
 * - lino-arguments: Unified configuration from CLI args, env vars, and .lenv files
 */

// Load locked dependencies through the shared loader, which normalizes the
// CommonJS namespace shape Node.js 23+ returns (see scripts/use-module.mjs).
import { useModule } from './use-module.mjs';
import { findReleaseId } from './github-release.mjs';

// Import link-foundation libraries
const { $ } = await useModule('command-stream');
const { makeConfig } = await useModule('lino-arguments');

// Parse CLI arguments using lino-arguments
// Note: Using --release-version instead of --version to avoid conflict with yargs' built-in --version flag
const config = makeConfig({
  yargs: ({ yargs, getenv }) =>
    yargs
      .option('release-version', {
        type: 'string',
        default: getenv('VERSION', ''),
        describe: 'Version number (e.g., 1.0.0)',
      })
      .option('repository', {
        type: 'string',
        default: getenv('REPOSITORY', ''),
        describe: 'GitHub repository (e.g., owner/repo)',
      })
      .option('commit-sha', {
        type: 'string',
        default: getenv('COMMIT_SHA', ''),
        describe: 'Commit SHA for PR detection',
      })
      .option('prefix', {
        type: 'string',
        default: getenv('PREFIX', ''),
        describe: 'Tag prefix (e.g., "js-" or "rust-")',
      }),
});

const { releaseVersion: version, repository, commitSha, prefix } = config;

if (!version || !repository || !commitSha) {
  console.error('Error: Missing required arguments');
  console.error(
    'Usage: node scripts/format-github-release.mjs --release-version <version> --repository <repository> --commit-sha <commit_sha>'
  );
  process.exit(1);
}

const tag = `${prefix}v${version}`;

try {
  // Get the release ID for this version
  const releaseId = await findReleaseId(async () => {
    const result =
      await $`gh api "repos/${repository}/releases/tags/${tag}"`.run({
        capture: true,
      });
    return JSON.parse(result.stdout);
  });
  if (releaseId === null) {
    console.log(`\u26A0\uFE0F No release exists for ${tag} (HTTP 404)`);
    process.exit(0);
  }

  if (releaseId) {
    console.log(`Formatting release notes for ${tag}...`);
    // Pass the trigger commit SHA for PR detection
    // This allows proper PR lookup even if the changelog doesn't have a commit hash
    // IMPORTANT: Pass version with v-prefix only (e.g., "v0.8.4"), NOT the full tag (e.g., "js-v0.8.4")
    // The format-release-notes.mjs script uses this for shields.io badge URL which uses dashes as delimiters
    // See: docs/case-studies/issue-123 for detailed root cause analysis
    await $`node scripts/format-release-notes.mjs --release-id "${releaseId}" --release-version "v${version}" --repository "${repository}" --commit-sha "${commitSha}"`;
    console.log(`\u2705 Formatted release notes for ${tag}`);
  }
} catch (error) {
  console.error('Error formatting release:', error.message);
  process.exit(1);
}
