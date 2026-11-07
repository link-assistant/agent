#!/usr/bin/env bun

/**
 * Create a changeset file for manual releases
 * Usage: node scripts/create-manual-changeset.mjs --bump-type <major|minor|patch> [--description <description>] [--js-root <path>]
 *
 * Uses link-foundation libraries:
 * - Lockfile-installed command-stream and lino-arguments helpers
 * - command-stream: Modern shell command execution with streaming support
 * - lino-arguments: Unified configuration from CLI args, env vars, and .lenv files
 */

import { mkdirSync, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { join } from 'path';

import { getChangesetDir, getJsRoot, parseJsRootConfig } from './js-paths.mjs';
import { formatChangesetHeader, readPackageInfo } from './package-info.mjs';
import { bootstrapDependencies } from './bootstrap-dependencies.mjs';
import { loadCommandStream, loadLinoArguments } from './use-module.mjs';
import { printUntrusted } from './github-actions-log.mjs';

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
        describe: 'Description for the changeset',
      })
      .option('js-root', {
        type: 'string',
        default: getenv('JS_ROOT', ''),
        describe:
          'JavaScript package root directory (auto-detected if not specified)',
      }),
});

try {
  const { bumpType, description: descriptionArg, jsRoot: jsRootArg } = config;

  // Use provided description or default based on bump type
  const description = descriptionArg || `Manual ${bumpType} release`;

  if (!bumpType || !['major', 'minor', 'patch'].includes(bumpType)) {
    console.error(
      'Usage: node scripts/create-manual-changeset.mjs --bump-type <major|minor|patch> [--description <description>]'
    );
    process.exit(1);
  }

  const jsRootConfig = jsRootArg || parseJsRootConfig();
  const jsRoot = getJsRoot({ jsRoot: jsRootConfig, verbose: true });
  const changesetDir = getChangesetDir({ jsRoot });
  const { name: packageName } = readPackageInfo({ jsRoot });

  // Generate a random changeset ID
  const changesetId = randomBytes(4).toString('hex');
  const changesetFile = join(changesetDir, `manual-release-${changesetId}.md`);

  // Create the changeset file with single quotes to match Prettier config
  const content = `---
${formatChangesetHeader(packageName, bumpType)}
---

${description}
`;

  mkdirSync(changesetDir, { recursive: true });
  writeFileSync(changesetFile, content, 'utf-8');

  console.log(`Created changeset: ${changesetFile}`);
  console.log('Content:');
  printUntrusted(content);

  // Format with Prettier
  console.log('\nFormatting with Prettier...');
  await $`npx prettier --write "${changesetFile}"`;

  console.log('\n✅ Changeset created and formatted successfully');
} catch (error) {
  console.error('Error creating changeset:', error.message);
  if (process.env.DEBUG) {
    console.error('Stack trace:', error.stack);
  }
  process.exit(1);
}
