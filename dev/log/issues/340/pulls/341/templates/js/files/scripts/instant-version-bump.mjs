#!/usr/bin/env bun

/**
 * Instant version bump script for manual releases.
 * Updates the version and the changelog directly, without the changeset
 * workflow.
 *
 * Usage: node scripts/instant-version-bump.mjs --bump-type <major|minor|patch> [--description <description>] [--js-root <path>]
 *
 * Configuration:
 * - CLI: --js-root <path> to explicitly set JavaScript root
 * - Environment: JS_ROOT=<path>
 *
 * Uses link-foundation libraries:
 * - Lockfile-installed command-stream and lino-arguments helpers
 * - command-stream: Modern shell command execution with streaming support
 * - lino-arguments: Unified configuration from CLI args, env vars, and .lenv files
 *
 * Repository layout: single-language and multi-language repositories are both
 * supported through a configurable JavaScript package root.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import {
  getJsRoot,
  getPackageJsonPath,
  needsCd,
  parseJsRootConfig,
} from './js-paths.mjs';
import { bootstrapDependencies } from './bootstrap-dependencies.mjs';
import { loadCommandStream, loadLinoArguments } from './use-module.mjs';
import { captureVersionTree, syncVersionLock } from './version-lock.mjs';
import { markdownLines } from './markdown-lines.mjs';

// Import link-foundation libraries
// Loaded through bootstrapDependencies: when installed helpers are unavailable,
// this script reports the failure and writes its outputs, and the process
// does not die inside module initialisation.
const [{ $ }, { makeConfig }] = await bootstrapDependencies([
  loadCommandStream,
  loadLinoArguments,
]);

// Parse CLI arguments using lino-arguments
const config = makeConfig({
  yargs: ({ yargs, getenv }) =>
    yargs
      .option('bump-type', {
        type: 'string',
        default: getenv('BUMP_TYPE', ''),
        describe: 'Version bump type: major, minor, or patch',
        choices: ['major', 'minor', 'patch'],
      })
      .option('description', {
        type: 'string',
        default: getenv('DESCRIPTION', ''),
        describe: 'Description for the version bump',
      })
      .option('js-root', {
        type: 'string',
        default: getenv('JS_ROOT', ''),
        describe:
          'JavaScript package root directory (auto-detected if not specified)',
      }),
});

// Store the original working directory to restore after cd commands
// IMPORTANT: command-stream's cd is a virtual command that calls process.chdir()
const originalCwd = process.cwd();

try {
  const { bumpType, description, jsRoot: jsRootArg } = config;

  // Get JavaScript package root (auto-detect or use explicit config)
  const jsRootConfig = jsRootArg || parseJsRootConfig();
  const jsRoot = getJsRoot({ jsRoot: jsRootConfig, verbose: true });
  const before = captureVersionTree(jsRoot);

  const finalDescription = description || `Manual ${bumpType} release`;

  if (!bumpType || !['major', 'minor', 'patch'].includes(bumpType)) {
    console.error(
      'Usage: node scripts/instant-version-bump.mjs --bump-type <major|minor|patch> [--description <description>] [--js-root <path>]'
    );
    process.exit(1);
  }

  console.log(`\nBumping version (${bumpType})...`);

  // Get current version
  const packageJsonPath = getPackageJsonPath({ jsRoot });
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  const oldVersion = packageJson.version;
  console.log(`Current version: ${oldVersion}`);

  // Bump version using npm version (doesn't create git tag)
  // IMPORTANT: cd is a virtual command that calls process.chdir(), so we restore after
  if (needsCd({ jsRoot })) {
    await $`cd ${jsRoot} && npm version ${bumpType} --no-git-tag-version --ignore-scripts`;
    process.chdir(originalCwd);
  } else {
    await $`npm version ${bumpType} --no-git-tag-version --ignore-scripts`;
  }

  // Get new version
  const updatedPackageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  const newVersion = updatedPackageJson.version;
  console.log(`New version: ${newVersion}`);

  // Update CHANGELOG.md
  console.log('\nUpdating CHANGELOG.md...');
  const changelogPath =
    jsRoot === '.' ? 'CHANGELOG.md' : join(jsRoot, 'CHANGELOG.md');
  let changelog = readFileSync(changelogPath, 'utf-8');

  // Create new changelog entry
  const newEntry = `## ${newVersion}

### ${bumpType.charAt(0).toUpperCase() + bumpType.slice(1)} Changes

- ${finalDescription}

`;

  // Insert new entry after the first heading (# Changelog or similar)
  // Look for the first ## heading and insert before it
  const proseLines = markdownLines(changelog).filter((line) => !line.code);
  const firstVersionMatch = proseLines.find((line) =>
    /^ {0,3}## /.test(line.text)
  );

  if (firstVersionMatch) {
    const insertPosition = firstVersionMatch.start;
    changelog =
      changelog.slice(0, insertPosition) +
      newEntry +
      changelog.slice(insertPosition);
  } else {
    // If no version headings exist, append after the main heading
    const mainHeadingMatch = proseLines.find((line) =>
      /^ {0,3}# .+/.test(line.text)
    );
    if (mainHeadingMatch) {
      const insertPosition =
        mainHeadingMatch.start + mainHeadingMatch.text.length;
      changelog = `${changelog.slice(0, insertPosition)}\n\n${newEntry}${changelog.slice(insertPosition)}`;
    } else {
      // If no headings at all, prepend
      changelog = `${newEntry}\n${changelog}`;
    }
  }

  writeFileSync(changelogPath, changelog, 'utf-8');
  console.log('✅ CHANGELOG.md updated');

  // Synchronize package-lock.json
  console.log('\nSynchronizing package-lock.json...');

  syncVersionLock(jsRoot, before);

  console.log('\n✅ Instant version bump complete');
  console.log(`Version: ${oldVersion} → ${newVersion}`);
} catch (error) {
  // Restore cwd on error
  process.chdir(originalCwd);
  console.error('Error during instant version bump:', error.message);
  if (process.env.DEBUG) {
    console.error('Stack trace:', error.stack);
  }
  process.exit(1);
}
