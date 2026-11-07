#!/usr/bin/env bun

/**
 * Validate changeset for CI - ensures exactly one valid changeset is added by the PR
 *
 * Key behavior:
 * - Only checks changeset files ADDED by the current PR (not pre-existing ones)
 * - Uses git diff to compare PR head against base branch
 * - Validates that the PR adds exactly one changeset with proper format
 * - Fails on unavailable comparisons; local scanning requires ALLOW_LOCAL_CHANGESET_SCAN=true
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

import { getChangesetDir, getJsRoot, parseJsRootConfig } from './js-paths.mjs';
import {
  getChangesetVersionTypeRegex,
  readPackageInfo,
} from './package-info.mjs';
import { printUntrusted } from './github-actions-log.mjs';
import {
  getPrComparison,
  getPrChanges,
  isTrustedReleasePr,
} from './pr-comparison.mjs';

/** Directory scanning is an explicit local mode, never a CI fallback. */
function getAddedChangesetFiles(changesetDir, jsRoot) {
  if (process.env.PR_AUTHOR === 'dependabot[bot]') {
    console.log('Skipping changeset validation for dependabot[bot]');
    return null;
  }
  if (process.env.ALLOW_LOCAL_CHANGESET_SCAN === 'true') {
    if (
      process.env.CI ||
      process.env.GITHUB_ACTIONS ||
      process.env.GITHUB_EVENT_NAME
    ) {
      throw new Error('Local changeset scanning is forbidden in CI');
    }
    console.log('Explicit local mode: scanning the changeset directory');
    return existsSync(changesetDir)
      ? readdirSync(changesetDir).filter(
          (file) => file.endsWith('.md') && file !== 'README.md'
        )
      : [];
  }
  const changes = getPrChanges(getPrComparison());
  if (isTrustedReleasePr()) {
    console.log('Skipping changeset validation for a trusted release PR');
    return null;
  }
  const packageRoot = jsRoot.replaceAll('\\', '/').replace(/^\.\//, '');
  const prefix =
    packageRoot === '.' ? '' : `${packageRoot.replace(/\/$/, '')}/`;
  const packagePaths = changes
    .flatMap((change) =>
      change.oldPath ? [change.oldPath, change.path] : [change.path]
    )
    .filter(
      (path) => path.startsWith(prefix) || path.startsWith('.github/workflows/')
    )
    .map((path) =>
      path.startsWith(prefix) ? path.slice(prefix.length) : path
    );
  const ignored = [
    'docs/',
    'examples/',
    'experiments/',
    'dev/log/',
    '.changeset/',
  ];
  const requiresChangeset = packagePaths.some(
    (path) =>
      !path.endsWith('.md') && !ignored.some((dir) => path.startsWith(dir))
  );
  const changesetPrefix = `${changesetDir.replaceAll('\\', '/').replace(/^\.\//, '')}/`;
  const added = changes
    .filter(
      (change) =>
        change.status === 'A' &&
        change.path.startsWith(changesetPrefix) &&
        change.path.endsWith('.md') &&
        change.path !== `${changesetPrefix}README.md`
    )
    .map((change) => change.path.slice(changesetPrefix.length));
  if (!requiresChangeset && added.length === 0) {
    console.log(
      'Documentation-only or excluded package paths: no changeset required'
    );
    return null;
  }
  return added;
}

/**
 * Validate a single changeset file
 * @param {string} filePath Full path to the changeset file
 * @param {string} packageName
 * @returns {{valid: boolean, type?: string, description?: string, error?: string}}
 */
function validateChangesetFile(filePath, packageName) {
  try {
    const content = readFileSync(filePath, 'utf-8');

    // Check if changeset has a valid type (major, minor, or patch)
    const versionTypeRegex = getChangesetVersionTypeRegex(packageName);
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    const versionTypeMatch = frontmatter?.[1].match(versionTypeRegex);

    if (!versionTypeMatch) {
      return {
        valid: false,
        error: `Changeset must specify a version type: major, minor, or patch\nExpected format:\n---\n'${packageName}': patch\n---\n\nYour description here`,
      };
    }

    // Extract description (everything after the closing ---) and check it's not empty
    const parts = content.split('---');
    if (parts.length < 3) {
      return {
        valid: false,
        error:
          "Changeset must include a description of the changes (after the closing '---')",
      };
    }

    const description = parts.slice(2).join('---').trim();
    if (!description) {
      return {
        valid: false,
        error: 'Changeset must include a non-empty description of the changes',
      };
    }

    return {
      valid: true,
      type: versionTypeMatch[1],
      description,
    };
  } catch (error) {
    return {
      valid: false,
      error: `Failed to read changeset file: ${error.message}`,
    };
  }
}

try {
  console.log('Validating changesets added by this PR...');
  const jsRootConfig = parseJsRootConfig();
  const jsRoot = getJsRoot({ jsRoot: jsRootConfig, verbose: true });
  const changesetDir = getChangesetDir({ jsRoot });
  const { name: packageName } = readPackageInfo({ jsRoot });
  console.log(`Package: ${packageName}`);

  // Get changeset files added in this PR
  const addedChangesetFiles = getAddedChangesetFiles(changesetDir, jsRoot);
  if (addedChangesetFiles === null) {
    process.exit(0);
  }
  const changesetCount = addedChangesetFiles.length;

  console.log(`Found ${changesetCount} changeset file(s) added by this PR`);
  if (changesetCount > 0) {
    console.log('Added changesets:');
    addedChangesetFiles.forEach((file) => console.log(`  - ${file}`));
  }

  // Ensure exactly one changeset file was added
  if (changesetCount === 0) {
    console.error(
      "::error::No changeset found in this PR. Please add a changeset by running 'npm run changeset' and commit the result."
    );
    process.exit(1);
  } else if (changesetCount > 1) {
    console.error(
      `::error::Multiple changesets found in this PR (${changesetCount}). Each PR should add exactly ONE changeset.`
    );
    console.error('::error::Found changeset files added by this PR:');
    addedChangesetFiles.forEach((file) => console.error(`  ${file}`));
    console.error(
      '\n::error::Please combine these into a single changeset or remove the extras.'
    );
    process.exit(1);
  }

  // Validate the single changeset file
  const changesetFile = join(changesetDir, addedChangesetFiles[0]);
  console.log(`Validating changeset: ${changesetFile}`);

  const validation = validateChangesetFile(changesetFile, packageName);

  if (!validation.valid) {
    console.error(`::error::${validation.error}`);
    console.error(`\nFile content of ${changesetFile}:`);
    try {
      printUntrusted(readFileSync(changesetFile, 'utf-8'), {
        stream: process.stderr,
      });
    } catch {
      console.error('(could not read file)');
    }
    process.exit(1);
  }

  console.log('Changeset validation passed');
  console.log(`   Type: ${validation.type}`);
  console.log('   Description:');
  printUntrusted(validation.description);
} catch (error) {
  console.error('Error during changeset validation:', error.message);
  if (process.env.DEBUG) {
    console.error('Stack trace:', error.stack);
  }
  process.exit(1);
}
