#!/usr/bin/env node

/**
 * Validate changeset for CI - ensures the pull request adds exactly one valid
 * changeset
 *
 * Only changesets the pull request adds count. Counting the whole directory let
 * an unreleased changeset from an earlier pull request satisfy the check, and
 * failed a pull request that added its own as "multiple changesets" (#337).
 *
 * The base branch comes from GITHUB_BASE_REF (set on pull_request events) or
 * CHANGESET_BASE_REF. Locally, without either, the directory is scanned.
 *
 * IMPORTANT: Update the package name below to match your package.json
 */

import { execFileSync } from 'child_process';
import { readdirSync, readFileSync } from 'fs';
import { basename, join } from 'path';

// Package name from package.json
const PACKAGE_NAME = '@link-assistant/agent';

const isChangesetFile = (file) =>
  file.endsWith('.md') && basename(file) !== 'README.md';

function getAddedChangesetFiles(changesetDir) {
  const baseRef = process.env.CHANGESET_BASE_REF || process.env.GITHUB_BASE_REF;
  if (!baseRef) {
    if (process.env.GITHUB_ACTIONS) {
      throw new Error(
        'GITHUB_BASE_REF is not set; the changeset check needs a pull_request event'
      );
    }
    console.log(`No base branch: scanning ${changesetDir} (local mode)`);
    return readdirSync(changesetDir).filter(isChangesetFile);
  }

  const range = `origin/${baseRef}...HEAD`;
  console.log(`Changesets added in ${range}:`);
  const added = execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=A', range, '--', changesetDir],
    { encoding: 'utf8' }
  );
  return added
    .split('\n')
    .filter(isChangesetFile)
    .map((file) => basename(file));
}

try {
  const changesetDir = 'js/.changeset';
  const changesetFiles = getAddedChangesetFiles(changesetDir);

  const changesetCount = changesetFiles.length;
  console.log(`Found ${changesetCount} changeset file(s)`);

  // Ensure exactly one changeset file exists
  if (changesetCount === 0) {
    console.error(
      "::error::This pull request adds no changeset. Please add a changeset by running 'npm run changeset' and commit the result."
    );
    process.exit(1);
  } else if (changesetCount > 1) {
    console.error(
      `::error::This pull request adds ${changesetCount} changesets. Each PR should add exactly ONE changeset.`
    );
    console.error('::error::Found changeset files:');
    changesetFiles.forEach((file) => console.error(`  ${file}`));
    process.exit(1);
  }

  // Get the changeset file
  const changesetFile = join(changesetDir, changesetFiles[0]);
  console.log(`Validating changeset: ${changesetFile}`);

  // Read the changeset file
  const content = readFileSync(changesetFile, 'utf-8');

  // Check if changeset has a valid type (major, minor, or patch)
  const versionTypeRegex = new RegExp(
    `^['"]${PACKAGE_NAME}['"]:\\s+(major|minor|patch)`,
    'm'
  );
  if (!versionTypeRegex.test(content)) {
    console.error(
      '::error::Changeset must specify a version type: major, minor, or patch'
    );
    console.error(`::error::Expected format in ${changesetFile}:`);
    console.error('::error::---');
    console.error(`::error::'${PACKAGE_NAME}': patch`);
    console.error('::error::---');
    console.error('::error::');
    console.error('::error::Your description here');
    console.error('\nFile content:');
    console.error(content);
    process.exit(1);
  }

  // Extract description (everything after the closing ---) and check it's not empty
  const parts = content.split('---');
  if (parts.length < 3) {
    console.error(
      '::error::Changeset must include a description of the changes'
    );
    console.error(
      "::error::The description should appear after the closing '---' in the changeset file"
    );
    console.error(`::error::Current content of ${changesetFile}:`);
    console.error(content);
    process.exit(1);
  }

  const description = parts.slice(2).join('---').trim();
  if (!description) {
    console.error(
      '::error::Changeset must include a description of the changes'
    );
    console.error(
      "::error::The description should appear after the closing '---' in the changeset file"
    );
    console.error(`::error::Current content of ${changesetFile}:`);
    console.error(content);
    process.exit(1);
  }

  // Extract version type
  const versionTypeMatch = content.match(versionTypeRegex);
  const versionType = versionTypeMatch ? versionTypeMatch[1] : 'unknown';

  console.log('✅ Changeset validation passed');
  console.log(`   Type: ${versionType}`);
  console.log(`   Description: ${description}`);
} catch (error) {
  console.error('Error during changeset validation:', error.message);
  if (process.env.DEBUG) {
    console.error('Stack trace:', error.stack);
  }
  process.exit(1);
}
