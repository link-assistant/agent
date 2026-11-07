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
 * - use-m: Dynamic package loading without package.json dependencies
 * - command-stream: Modern shell command execution with streaming support
 */

// Load dependencies through the shared use-m loader, which normalizes the
// CommonJS namespace shape Node.js 23+ returns (see scripts/use-module.mjs).
import { useModule } from './use-module.mjs';
import { assertChangesetsConsumed } from './changeset-files.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { setJsLockVersion } from './release-safety.mjs';

// Import command-stream for shell command execution
const { $ } = await useModule('command-stream');

try {
  console.log('Running changeset version...');
  // command-stream does not throw on a non-zero exit code.
  const versionResult = await $`npx changeset version`;
  if (versionResult.code !== 0) {
    throw new Error(`changeset version exited with code ${versionResult.code}`);
  }
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
