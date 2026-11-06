#!/usr/bin/env node

/**
 * Check if a release is needed based on changesets and npm registry state
 *
 * This script checks:
 * 1. If there are changeset files to process
 * 2. If the current version has already been published to npm
 * 3. If an npm-published version also has its GitHub release
 *
 * npm publication and a GitHub release are independent requirements. If npm
 * already has the version but its GitHub release is missing, the next main
 * push retries publication verification and creates that release without a bump.
 * Unknown GitHub state does not trigger a release.
 *
 * Analogous to check-release-needed.rs in the Rust template.
 *
 * Supports both single-language and multi-language repository structures:
 * - Single-language: package.json in repository root
 * - Multi-language: package.json in js/ subfolder
 *
 * Usage: node scripts/check-release-needed.mjs [--js-root <path>]
 *
 * Environment variables:
 *   - HAS_CHANGESETS: 'true' if changeset files exist (from check-changesets.mjs)
 *
 * Outputs (written to GITHUB_OUTPUT):
 *   - should_release: 'true' if a release should be created
 *   - skip_bump: 'true' when recovering the existing version without changesets
 */

import { appendFileSync } from 'fs';

import { getJsRoot, parseJsRootConfig } from './js-paths.mjs';
import { isPackageVersionPublished } from './npm-registry.mjs';
import { readPackageInfo } from './package-info.mjs';
import { buildReleaseTag } from './release-naming.mjs';
import { githubReleaseExists } from './github-release-state.mjs';

const jsRootConfig = parseJsRootConfig();
const jsRoot = getJsRoot({ jsRoot: jsRootConfig, verbose: true });

/**
 * Write output to GitHub Actions output file
 * @param {string} name - Output name
 * @param {string} value - Output value
 */
function setOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${name}=${value}\n`);
  }
  console.log(`Output: ${name}=${value}`);
}

/**
 * Get the package name and version from package.json
 * @returns {{ name: string, version: string }}
 */
function getPackageInfo() {
  return readPackageInfo({ jsRoot });
}

/**
 * Check if a specific version is published on npm
 * @param {string} packageName
 * @param {string} version
 * @returns {Promise<boolean>}
 */
function checkVersionOnNpm(packageName, version) {
  return isPackageVersionPublished(packageName, version);
}

async function main() {
  const hasChangesets = process.env.HAS_CHANGESETS === 'true';
  const { name: packageName, version: currentVersion } = getPackageInfo();

  console.log(`Package: ${packageName}`);
  console.log(`Current version: ${currentVersion}`);
  console.log(`Has changesets: ${hasChangesets}`);

  if (hasChangesets) {
    console.log('Found changesets, proceeding with release');
    setOutput('should_release', 'true');
    setOutput('skip_bump', 'false');
    return;
  }

  console.log(
    `Checking if ${packageName}@${currentVersion} is published on npm...`
  );
  const isPublished = await checkVersionOnNpm(packageName, currentVersion);
  console.log(`Published on npm: ${isPublished}`);

  if (isPublished) {
    const tag = buildReleaseTag(currentVersion, { jsRoot });
    const releaseExists = await githubReleaseExists(tag);
    if (releaseExists === false) {
      console.log(
        `${tag} is on npm but has no GitHub release — self-healing release creation`
      );
      setOutput('should_release', 'true');
      setOutput('skip_bump', 'true');
    } else {
      console.log(
        releaseExists === null
          ? 'GitHub state unknown — no release will run'
          : `${tag} is already published on npm and GitHub — no release needed`
      );
      setOutput('should_release', 'false');
      setOutput('skip_bump', 'false');
    }
  } else {
    console.log(
      `No changesets but v${currentVersion} not yet published to npm — release needed (self-healing)`
    );
    setOutput('should_release', 'true');
    setOutput('skip_bump', 'true');
  }
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
