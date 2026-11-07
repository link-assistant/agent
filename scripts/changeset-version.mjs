#!/usr/bin/env node

/**
 * Custom changeset version script that ensures package-lock.json is synchronized
 * with package.json after version bumps.
 *
 * This script:
 * 1. Runs `changeset version` to update package versions, and fails if it
 *    exits with an error or leaves changeset files behind
 * 2. Updates only package-lock.json's root version, preserving tested dependencies
 *
 * Uses link-foundation libraries:
 * - command-stream: Modern shell command execution with streaming support
 */

// Load locked dependencies through the shared loader, which normalizes the
// CommonJS namespace shape Node.js 23+ returns (see scripts/use-module.mjs).
import { useModule } from './use-module.mjs';
import { assertChangesetsConsumed } from './changeset-files.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { setJsLockVersion } from './release-safety.mjs';

// Import command-stream for shell command execution
const { $ } = await useModule('command-stream');

try {
  console.log('Running changeset version...');
  // The shared loader enables errexit, so a failed version command is fatal.
  await $`npx changeset version`;
  assertChangesetsConsumed('.changeset');

  console.log('\nSynchronizing package-lock.json...');
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
  writeFileSync(
    'package-lock.json',
    setJsLockVersion(readFileSync('package-lock.json', 'utf8'), version)
  );

  console.log('\n✅ Version bump complete with synchronized package-lock.json');
} catch (error) {
  console.error('Error during version bump:', error.message);
  if (process.env.DEBUG) {
    console.error('Stack trace:', error.stack);
  }
  process.exit(1);
}
