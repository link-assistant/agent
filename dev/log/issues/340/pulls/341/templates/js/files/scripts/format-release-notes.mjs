#!/usr/bin/env node

/**
 * Script to format GitHub release notes:
 * - Keep the change sections as Changesets wrote them (paragraphs, nested
 *   lists and rules stay inside their entry)
 * - Add links to the PRs that contain the changelog commits (if found)
 * - Add shields.io NPM version badge
 *
 * PR Detection Logic:
 * 1. Extract the commit hash of every changelog entry (if present)
 * 2. Fall back to --commit-sha argument (passed from workflow)
 * 3. Look up PRs that contain each commit via GitHub API
 * 4. If no PR found, simply don't display any PR link (no guessing)
 *
 * Uses link-foundation libraries:
 * - Lockfile-installed command-stream and lino-arguments helpers
 * - command-stream: Modern shell command execution with streaming support
 * - lino-arguments: Unified configuration from CLI args, env vars, and .lenv files
 *
 * The version flag is named --release-version because yargs reserves
 * --version for its own built-in flag.
 */

import { getJsRoot, parseJsRootConfig } from './js-paths.mjs';
import { readPackageInfo } from './package-info.mjs';
import {
  buildNpmVersionBadge,
  buildReleaseDescription,
  hasGeneratedNpmBadge,
  normalizeReleaseVersionForBadge,
} from './format-release-notes-helpers.mjs';
import { bootstrapDependencies } from './bootstrap-dependencies.mjs';
import { loadCommandStream, loadLinoArguments } from './use-module.mjs';
import {
  validateReleaseData,
  validatePullRequestPages,
} from './github-api-evidence.mjs';

// Import link-foundation libraries
// Loaded through bootstrapDependencies: when installed helpers are unavailable,
// this script reports the failure and writes its outputs, and the process
// does not die inside module initialisation.
const [{ $ }, { makeConfig }] = await bootstrapDependencies([
  loadCommandStream,
  loadLinoArguments,
]);

// Parse CLI arguments using lino-arguments
// The flag is named --release-version because yargs reserves --version for
// its own built-in flag.
const config = makeConfig({
  yargs: ({ yargs, getenv }) =>
    yargs
      .option('release-version', {
        type: 'string',
        default: getenv('VERSION', ''),
        describe: 'Version number (e.g., v0.8.36)',
      })
      .option('release-id', {
        type: 'string',
        default: getenv('RELEASE_ID', ''),
        describe: 'GitHub release ID',
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
      .option('js-root', {
        type: 'string',
        default: getenv('JS_ROOT', ''),
        describe:
          'JavaScript package root directory (auto-detected if not specified)',
      }),
});

const releaseId = config.releaseId;
const version = config.releaseVersion;
const repository = config.repository;
const passedCommitSha = config.commitSha;
const jsRootConfig = config.jsRoot || parseJsRootConfig();
const jsRoot = getJsRoot({ jsRoot: jsRootConfig, verbose: true });
const { name: packageName } = readPackageInfo({ jsRoot });

if (!releaseId || !version || !repository) {
  console.error(
    'Usage: format-release-notes.mjs --release-id <releaseId> --release-version <version> --repository <repository> [--commit-sha <sha>]'
  );
  process.exit(1);
}

try {
  // Get current release body
  const result = await $`gh api repos/${repository}/releases/${releaseId}`.run({
    capture: true,
  });
  const releaseData = validateReleaseData(JSON.parse(result.stdout), {
    id: releaseId,
  });

  const currentBody = releaseData.body || '';

  // Skip only a generated npm badge image.
  if (hasGeneratedNpmBadge(currentBody)) {
    console.log('ℹ️ Release notes already formatted');
    process.exit(0);
  }

  const parsed = buildReleaseDescription(currentBody);
  if (!parsed?.description) {
    console.log('⚠️ Could not parse changes from release notes');
    console.log('   Looking for pattern: ### [Major|Minor|Patch] Changes');
    process.exit(1);
  }
  const { description: cleanDescription, commitHashes } = parsed;

  // Link the pull requests of every changelog entry; fall back to the
  // commit the workflow passed when no entry names one. No PR, no link.
  const commitShas =
    commitHashes.length > 0 ? commitHashes : [passedCommitSha].filter(Boolean);
  const prNumbers = [];

  if (commitShas.length === 0) {
    console.log('ℹ️ No commit SHA available - not adding PR link');
  }
  for (const commitSha of commitShas) {
    const source = commitHashes.length > 0 ? 'changelog' : 'workflow';
    console.log(`ℹ️ Looking up PR for commit ${commitSha} (from ${source})`);

    const prResult =
      await $`gh api "repos/${repository}/commits/${commitSha}/pulls" --paginate --slurp`.run(
        { capture: true }
      );
    const prsData = validatePullRequestPages(JSON.parse(prResult.stdout));
    for (const pr of prsData) {
      if (
        !pr.title.toLowerCase().includes('version packages') &&
        !prNumbers.includes(pr.number)
      ) {
        prNumbers.push(pr.number);
        console.log(`✅ Found PR #${pr.number} containing commit`);
      }
    }
  }

  // Build formatted release notes
  const versionWithoutV = normalizeReleaseVersionForBadge(version);
  const npmBadge = buildNpmVersionBadge(packageName, version);

  let formattedBody = `${cleanDescription}`;

  if (prNumbers.length === 1) {
    formattedBody += `\n\n**Related Pull Request:** #${prNumbers[0]}`;
  } else if (prNumbers.length > 1) {
    formattedBody += `\n\n**Related Pull Requests:** ${prNumbers
      .map((number) => `#${number}`)
      .join(', ')}`;
  }

  formattedBody += `\n\n---\n\n${npmBadge}`;

  // Update the release using JSON input to properly handle special characters
  const updatePayload = JSON.stringify({ body: formattedBody });
  await $`gh api repos/${repository}/releases/${releaseId} -X PATCH --input -`.run(
    { stdin: updatePayload }
  );

  console.log(`✅ Formatted release notes for v${versionWithoutV}`);
  for (const prNumber of prNumbers) {
    console.log(`   - Added link to PR #${prNumber}`);
  }
  console.log('   - Added shields.io npm badge');
} catch (error) {
  console.error('❌ Error formatting release notes:', error.message);
  process.exit(1);
}
