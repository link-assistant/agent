#!/usr/bin/env node

/**
 * Publish Rust crate to crates.io with verification
 *
 * Usage: node scripts/publish-to-crates.mjs [--should-pull]
 *
 * Features:
 * - Checks if version is already published before attempting
 * - Publishes with retry logic
 * - Verifies the crate actually appeared on crates.io after publishing
 * - Outputs `published=true` and `published_version=X.Y.Z` for GitHub Actions
 *
 * Required environment variables:
 * - CARGO_REGISTRY_TOKEN: API token for crates.io
 *
 * Optional environment variables:
 * - GITHUB_OUTPUT: GitHub Actions output file path
 */

import { readFileSync, appendFileSync } from 'fs';
import { execSync } from 'child_process';

import {
  getRustRoot,
  getCargoTomlPath,
  needsCd,
  parseRustRootConfig,
} from './rust-paths.mjs';

const MAX_RETRIES = 3;
const RETRY_DELAY = 10000; // 10 seconds
const VERIFY_DELAY = 5000; // 5 seconds for crates.io propagation

const args = process.argv.slice(2);
const getArg = (name, defaultValue) => {
  const index = args.indexOf(`--${name}`);
  if (name === 'should-pull') {
    return index >= 0;
  }
  return index >= 0 && args[index + 1] ? args[index + 1] : defaultValue;
};

const shouldPull = getArg('should-pull', false);
const rustRootConfig = getArg('rust-root', '') || parseRustRootConfig();
const rustRoot = getRustRoot({
  rustRoot: rustRootConfig || undefined,
  verbose: true,
});

const CARGO_TOML = getCargoTomlPath({ rustRoot });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${key}=${value}\n`);
  }
  console.log(`Output: ${key}=${value}`);
}

function exec(command, options = {}) {
  const { capture = false, allowFailure = false } = options;
  try {
    const result = execSync(command, {
      encoding: 'utf-8',
      stdio: capture ? 'pipe' : 'inherit',
    });
    return { code: 0, stdout: result || '', stderr: '' };
  } catch (error) {
    if (allowFailure) {
      return {
        code: error.status || 1,
        stdout: error.stdout || '',
        stderr: error.stderr || '',
      };
    }
    throw error;
  }
}

function getPackageName() {
  const cargoToml = readFileSync(CARGO_TOML, 'utf-8');
  const match = cargoToml.match(/^name\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error(`Could not parse package name from ${CARGO_TOML}`);
  }
  return match[1];
}

function getCurrentVersion() {
  const cargoToml = readFileSync(CARGO_TOML, 'utf-8');
  const match = cargoToml.match(/^version\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error(`Could not parse version from ${CARGO_TOML}`);
  }
  return match[1];
}

/**
 * Check if a specific version of a crate is published on crates.io
 */
async function checkCratesIo(packageName, version) {
  try {
    const response = await fetch(
      `https://crates.io/api/v1/crates/${packageName}/${version}`
    );
    if (response.ok) {
      const data = await response.json();
      return data.version && data.version.num === version;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Check if the crate exists at all on crates.io (any version)
 */
async function checkCrateExists(packageName) {
  try {
    const response = await fetch(
      `https://crates.io/api/v1/crates/${packageName}`
    );
    if (response.ok) {
      const data = await response.json();
      return {
        exists: true,
        owners: data.crate?.owners || [],
        versions: (data.versions || []).map((v) => v.num),
      };
    }
    return { exists: false };
  } catch {
    return { exists: false };
  }
}

const FAILURE_PATTERNS = [
  'error[E',
  'error: ',
  '403 Forbidden',
  '401 Unauthorized',
  'the remote server responded with an error',
  'crate already uploaded',
];

function detectPublishFailure(output) {
  for (const pattern of FAILURE_PATTERNS) {
    if (output.includes(pattern)) {
      return pattern;
    }
  }
  return null;
}

async function main() {
  try {
    if (shouldPull) {
      console.log('Pulling latest changes...');
      exec('git pull origin main');
    }

    const packageName = getPackageName();
    const currentVersion = getCurrentVersion();
    console.log(
      `Publishing ${packageName}@${currentVersion} to crates.io...`
    );

    // Check if this version is already published
    console.log(
      `Checking if ${packageName}@${currentVersion} is already on crates.io...`
    );
    const alreadyPublished = await checkCratesIo(packageName, currentVersion);

    if (alreadyPublished) {
      console.log(
        `Version ${currentVersion} is already published on crates.io`
      );
      setOutput('published', 'true');
      setOutput('published_version', currentVersion);
      setOutput('already_published', 'true');
      return;
    }

    // Check if crate exists at all (to detect name conflicts early)
    const crateInfo = await checkCrateExists(packageName);
    if (crateInfo.exists) {
      console.log(
        `Crate ${packageName} exists on crates.io with versions: ${crateInfo.versions.join(', ')}`
      );
    } else {
      console.log(
        `Crate ${packageName} does not exist on crates.io yet (first publish)`
      );
    }

    // Verify CARGO_REGISTRY_TOKEN is set
    if (!process.env.CARGO_REGISTRY_TOKEN) {
      console.error(
        'Error: CARGO_REGISTRY_TOKEN environment variable is not set'
      );
      process.exit(1);
    }

    // Publish with retry logic
    const cargoPublishCmd = needsCd({ rustRoot })
      ? `cd ${rustRoot} && cargo publish --verbose --allow-dirty`
      : 'cargo publish --verbose --allow-dirty';

    for (let i = 1; i <= MAX_RETRIES; i++) {
      console.log(`\nPublish attempt ${i} of ${MAX_RETRIES}...`);
      let lastError = null;

      const result = exec(cargoPublishCmd, {
        capture: true,
        allowFailure: true,
      });

      const combinedOutput = `${result.stdout}\n${result.stderr}`;

      if (combinedOutput.trim()) {
        console.log('cargo publish output:');
        console.log(combinedOutput);
      }

      // Check exit code
      if (result.code !== 0) {
        console.error(`cargo publish exited with code ${result.code}`);
        lastError = new Error(
          `cargo publish failed with exit code ${result.code}`
        );
      }

      // Check for failure patterns in output
      const failurePattern = detectPublishFailure(combinedOutput);
      if (failurePattern) {
        // "crate already uploaded" is actually a success case
        if (failurePattern === 'crate already uploaded') {
          console.log('Crate was already uploaded (race condition), treating as success');
        } else {
          console.error(`Detected publish failure: "${failurePattern}"`);
          lastError =
            lastError ||
            new Error(`Publish failed: detected "${failurePattern}" in output`);
        }
      }

      if (!lastError) {
        // Verify the crate is actually on crates.io
        console.log(
          `Waiting ${VERIFY_DELAY / 1000}s for crates.io propagation...`
        );
        await sleep(VERIFY_DELAY);

        console.log('Verifying crate was published to crates.io...');
        const isPublished = await checkCratesIo(packageName, currentVersion);

        if (isPublished) {
          setOutput('published', 'true');
          setOutput('published_version', currentVersion);
          console.log(
            `\u2705 Published ${packageName}@${currentVersion} to crates.io`
          );
          return;
        } else {
          console.error(
            `Verification failed: ${packageName}@${currentVersion} not found on crates.io after publish`
          );
          lastError = new Error(
            'Crate not found on crates.io after publish attempt'
          );
        }
      }

      // Retry or fail
      if (lastError) {
        if (i < MAX_RETRIES) {
          console.log(
            `Publish failed, waiting ${RETRY_DELAY / 1000}s before retry...`
          );
          await sleep(RETRY_DELAY);
        }
      }
    }

    console.error(`\u274c Failed to publish after ${MAX_RETRIES} attempts`);
    setOutput('published', 'false');
    process.exit(1);
  } catch (error) {
    console.error('Error:', error.message);
    setOutput('published', 'false');
    process.exit(1);
  }
}

main();
