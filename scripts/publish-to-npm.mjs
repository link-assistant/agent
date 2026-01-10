#!/usr/bin/env node

/**
 * Publish to npm using OIDC trusted publishing
 * Usage: node scripts/publish-to-npm.mjs [--should-pull]
 *   should_pull: Optional flag to pull latest changes before publishing (for release job)
 *
 * IMPORTANT: Update the PACKAGE_NAME constant below to match your package.json
 *
 * Uses link-foundation libraries:
 * - use-m: Dynamic package loading without package.json dependencies
 * - command-stream: Modern shell command execution with streaming support
 * - lino-arguments: Unified configuration from CLI args, env vars, and .lenv files
 */

import { readFileSync, appendFileSync } from 'fs';

import {
  getJsRoot,
  getPackageJsonPath,
  needsCd,
  parseJsRootConfig,
} from './js-paths.mjs';

// Package name from package.json
const PACKAGE_NAME = '@link-assistant/agent';

// Load use-m dynamically
const { use } = eval(
  await (await fetch('https://unpkg.com/use-m/use.js')).text()
);

// Import link-foundation libraries
const { $ } = await use('command-stream');
const { makeConfig } = await use('lino-arguments');

// Parse CLI arguments using lino-arguments
const config = makeConfig({
  yargs: ({ yargs, getenv }) =>
    yargs
      .option('should-pull', {
        type: 'boolean',
        default: getenv('SHOULD_PULL', false),
        describe: 'Pull latest changes before publishing',
      })
      .option('js-root', {
        type: 'string',
        default: getenv('JS_ROOT', ''),
        describe: 'JavaScript package root directory (auto-detected if not specified)',
      }),
});

const { shouldPull, jsRoot: jsRootArg } = config;

// Get JavaScript package root (auto-detect or use explicit config)
const jsRootConfig = jsRootArg || parseJsRootConfig();
const jsRoot = getJsRoot({ jsRoot: jsRootConfig, verbose: true });
const MAX_RETRIES = 3;
const RETRY_DELAY = 10000; // 10 seconds

// Patterns that indicate publish failure in changeset output
const FAILURE_PATTERNS = [
  'packages failed to publish',
  'error occurred while publishing',
  'npm error code E',
  'npm error 404',
  'npm error 401',
  'npm error 403',
  'Access token expired',
  'ENEEDAUTH',
];

/**
 * Sleep for specified milliseconds
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

/**
 * Check if the output contains any failure patterns
 * @param {string} output - Combined stdout and stderr
 * @returns {string|null} - The matched failure pattern or null if no failure detected
 */
function detectPublishFailure(output) {
  const lowerOutput = output.toLowerCase();
  for (const pattern of FAILURE_PATTERNS) {
    if (lowerOutput.includes(pattern.toLowerCase())) {
      return pattern;
    }
  }
  return null;
}

/**
 * Verify that a package version is published on npm
 * @param {string} packageName
 * @param {string} version
 * @returns {Promise<boolean>}
 */
async function verifyPublished(packageName, version) {
  const result = await $`npm view "${packageName}@${version}" version`.run({
    capture: true,
  });
  return result.code === 0 && result.stdout.trim().includes(version);
}

/**
 * Append to GitHub Actions output file
 * @param {string} key
 * @param {string} value
 */
function setOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${key}=${value}\n`);
  }
}

async function main() {
  // Store the original working directory to restore after cd commands
  // IMPORTANT: command-stream's cd is a virtual command that calls process.chdir()
  const originalCwd = process.cwd();

  try {
    if (shouldPull) {
      // Pull the latest changes we just pushed
      await $`git pull origin main`;
    }

    // Get current version
    const packageJsonPath = getPackageJsonPath({ jsRoot });
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    const currentVersion = packageJson.version;
    console.log(`Current version to publish: ${currentVersion}`);

    // Check if this version is already published on npm
    console.log(
      `Checking if version ${currentVersion} is already published...`
    );
    const checkResult =
      await $`npm view "${PACKAGE_NAME}@${currentVersion}" version`.run({
        capture: true,
      });

    // command-stream returns { code: 0 } on success, { code: 1 } on failure (e.g., E404)
    // Exit code 0 means version exists, non-zero means version not found
    if (checkResult.code === 0) {
      console.log(`Version ${currentVersion} is already published to npm`);
      setOutput('published', 'true');
      setOutput('published_version', currentVersion);
      setOutput('already_published', 'true');
      return;
    } else {
      // Version not found on npm (E404), proceed with publish
      console.log(
        `Version ${currentVersion} not found on npm, proceeding with publish...`
      );
    }

    // Publish to npm using OIDC trusted publishing with retry logic
    for (let i = 1; i <= MAX_RETRIES; i++) {
      console.log(`Publish attempt ${i} of ${MAX_RETRIES}...`);
      let publishResult;
      let lastError = null;

      try {
        // Run changeset:publish from the js directory where package.json with this script exists
        // IMPORTANT: Use .run({ capture: true }) to capture output for failure detection
        // IMPORTANT: cd is a virtual command that calls process.chdir(), so we restore after
        if (needsCd({ jsRoot })) {
          publishResult = await $`cd ${jsRoot} && npm run changeset:publish`.run({ capture: true });
          process.chdir(originalCwd);
        } else {
          publishResult = await $`npm run changeset:publish`.run({ capture: true });
        }
      } catch (error) {
        // Restore cwd on error before retry
        if (needsCd({ jsRoot })) {
          process.chdir(originalCwd);
        }
        lastError = error;
      }

      // Check for failures in multiple ways:
      // 1. Check if command threw an exception
      // 2. Check exit code (changeset may not return non-zero, but check anyway)
      // 3. Check output for failure patterns (most reliable for changeset)
      // 4. Verify package is actually on npm (ultimate verification)

      const combinedOutput = publishResult
        ? `${publishResult.stdout || ''}\n${publishResult.stderr || ''}`
        : '';

      // Log the output for debugging
      if (combinedOutput.trim()) {
        console.log('Changeset output:', combinedOutput);
      }

      // Check for failure patterns in output
      const failurePattern = detectPublishFailure(combinedOutput);
      if (failurePattern) {
        console.error(`Detected publish failure: "${failurePattern}"`);
        lastError = new Error(`Publish failed: detected "${failurePattern}" in output`);
      }

      // Check exit code (if available and non-zero)
      if (publishResult && publishResult.code !== 0) {
        console.error(`Changeset exited with code ${publishResult.code}`);
        lastError = lastError || new Error(`Publish failed with exit code ${publishResult.code}`);
      }

      // If no errors detected so far, verify the package is actually on npm
      if (!lastError) {
        console.log('Verifying package was published to npm...');
        // Wait a moment for npm registry to propagate
        await sleep(2000);
        const isPublished = await verifyPublished(PACKAGE_NAME, currentVersion);

        if (isPublished) {
          setOutput('published', 'true');
          setOutput('published_version', currentVersion);
          console.log(
            `\u2705 Published ${PACKAGE_NAME}@${currentVersion} to npm`
          );
          return;
        } else {
          console.error('Verification failed: package not found on npm after publish');
          lastError = new Error('Package not found on npm after publish attempt');
        }
      }

      // If we have an error, either retry or fail
      if (lastError) {
        if (i < MAX_RETRIES) {
          console.log(
            `Publish failed, waiting ${RETRY_DELAY / 1000}s before retry...`
          );
          await sleep(RETRY_DELAY);
        }
      }
    }

    console.error(`\u274C Failed to publish after ${MAX_RETRIES} attempts`);
    process.exit(1);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
