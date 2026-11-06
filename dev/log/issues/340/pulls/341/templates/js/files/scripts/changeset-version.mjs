#!/usr/bin/env bun

/**
 * Custom changeset version script that ensures package-lock.json is synchronized
 * with package.json after version bumps.
 *
 * This script:
 * 1. Detects the JavaScript package root (supports both single-language and multi-language repos)
 * 2. Runs `changeset version` to update package versions
 * 3. Changes only the two root lock versions, preserving the validated graph
 *
 * Configuration:
 * - CLI: --js-root <path> to explicitly set JavaScript root
 * - Environment: JS_ROOT=<path>
 *
 * Uses link-foundation libraries:
 * - Lockfile-installed command-stream and lino-arguments helpers
 * - command-stream: Modern shell command execution with streaming support
 *
 * Repository layout: single-language and multi-language repositories are both
 * supported through a configurable JavaScript package root.
 */

import { getJsRoot, needsCd, parseJsRootConfig } from './js-paths.mjs';
import { bootstrapDependencies } from './bootstrap-dependencies.mjs';
import { loadCommandStream } from './use-module.mjs';
import { captureVersionTree, syncVersionLock } from './version-lock.mjs';

// Import command-stream for shell command execution
// Loaded through bootstrapDependencies: when installed helpers are unavailable,
// this script reports the failure and writes its outputs, and the process
// does not die inside module initialisation.
const [{ $ }] = await bootstrapDependencies([loadCommandStream]);

// Store the original working directory to restore after cd commands
// IMPORTANT: command-stream's cd is a virtual command that calls process.chdir()
const originalCwd = process.cwd();

try {
  // Get JavaScript package root (auto-detect or use explicit config)
  const jsRootConfig = parseJsRootConfig();
  const jsRoot = getJsRoot({ jsRoot: jsRootConfig, verbose: true });
  const before = captureVersionTree(jsRoot);

  console.log('Running changeset version...');

  // IMPORTANT: cd is a virtual command that calls process.chdir(), so we restore after
  if (needsCd({ jsRoot })) {
    await $`cd ${jsRoot} && npx --no-install changeset version`;
    process.chdir(originalCwd);
  } else {
    await $`npx --no-install changeset version`;
  }

  console.log('\nSynchronizing package-lock.json...');

  syncVersionLock(jsRoot, before);

  console.log('\n✅ Version bump complete with synchronized package-lock.json');
} catch (error) {
  // Restore cwd on error
  process.chdir(originalCwd);
  console.error('Error during version bump:', error.message);
  if (process.env.DEBUG) {
    console.error('Stack trace:', error.stack);
  }
  process.exit(1);
}
