#!/usr/bin/env node

/**
 * Publish the Rust crate to crates.io with verification.
 *
 * Usage: node scripts/publish-to-crates.mjs [--should-pull] [--rust-root <path>]
 *
 * Behaviour:
 * - Reads crate name/version from the [package] section of Cargo.toml only
 *   (see scripts/rust-package-info.mjs for why a plain regex is not enough).
 * - Skips publishing when the version is already on crates.io.
 * - Retries only genuine publish failures. A successful publish, or an
 *   "already uploaded" conflict, moves straight to bounded verification
 *   polling and never re-enters the publish path.
 * - Outputs `published=true` and `published_version=X.Y.Z` for GitHub Actions.
 *
 * Required environment variables (at least one must be set):
 * - CARGO_REGISTRY_TOKEN: API token for crates.io (in CI, the short-lived
 *   trusted publishing token from rust-lang/crates-io-auth-action, or the
 *   long-lived secret as a fallback)
 * - CARGO_TOKEN: Fallback API token (e.g. set at organization level)
 *
 * Optional environment variables:
 * - GITHUB_OUTPUT: GitHub Actions output file path
 */

import { execSync } from 'child_process';
import { appendFileSync } from 'fs';

import { classifyCargoPublish } from './cargo-publish-result.mjs';
import { isCrateVersionPublished } from './crates-registry.mjs';
import { publishWithRetry, sleep } from './publish-retry.mjs';
import { readCrateInfo } from './rust-package-info.mjs';
import { getRustRoot, needsCd, parseRustRootConfig } from './rust-paths.mjs';

const MAX_RETRIES = 3;
const RETRY_DELAY = 10000; // 10 seconds
// crates.io index propagation is slower than npm's, so verification starts
// later and is given more attempts.
const VERIFY_OPTIONS = {
  attempts: 8,
  initialDelay: 10000,
  maxDelay: 30000,
};

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

function setOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${key}=${value}\n`);
  }
  console.log(`Output: ${key}=${value}`);
}

/**
 * Run a command, returning its exit code and captured output instead of
 * throwing, so the classifier decides what the outcome means.
 */
function runCommand(command) {
  try {
    const stdout = execSync(command, { encoding: 'utf-8', stdio: 'pipe' });
    return { code: 0, stdout: stdout || '', stderr: '' };
  } catch (error) {
    return {
      code: error.status || 1,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
    };
  }
}

/**
 * Look the version up on crates.io, treating a transient registry error as
 * "unknown" rather than "not published".
 */
async function verifyPublished(crateName, version) {
  try {
    return await isCrateVersionPublished(crateName, version);
  } catch (error) {
    console.log(`crates.io lookup failed: ${error.message}`);
    return false;
  }
}

function resolveCargoToken() {
  if (!process.env.CARGO_REGISTRY_TOKEN && process.env.CARGO_TOKEN) {
    console.log('CARGO_REGISTRY_TOKEN not set, using CARGO_TOKEN as fallback');
    process.env.CARGO_REGISTRY_TOKEN = process.env.CARGO_TOKEN;
  }
  return Boolean(process.env.CARGO_REGISTRY_TOKEN);
}

async function main() {
  try {
    if (shouldPull) {
      console.log('Pulling latest changes...');
      execSync('git pull origin main', { stdio: 'inherit' });
    }

    const { name: crateName, version: currentVersion } = readCrateInfo({
      rustRoot,
    });
    console.log(`Publishing ${crateName}@${currentVersion} to crates.io...`);

    if (await verifyPublished(crateName, currentVersion)) {
      console.log(
        `Version ${currentVersion} is already published on crates.io`
      );
      setOutput('published', 'true');
      setOutput('published_version', currentVersion);
      setOutput('already_published', 'true');
      return;
    }

    if (!resolveCargoToken()) {
      console.error(
        'Error: Neither CARGO_REGISTRY_TOKEN nor CARGO_TOKEN environment variable is set'
      );
      setOutput('published', 'false');
      process.exit(1);
    }

    const cargoPublishCmd = needsCd({ rustRoot })
      ? `cd ${rustRoot} && cargo publish --allow-dirty`
      : 'cargo publish --allow-dirty';

    // Set when cargo itself accepted the upload; used to distinguish
    // "the upload never happened" from "the index has not caught up yet".
    let uploadAccepted = false;

    const { success, error } = await publishWithRetry({
      publish: () => {
        const result = runCommand(cargoPublishCmd);
        const classified = classifyCargoPublish(result);
        uploadAccepted = uploadAccepted || classified.success;
        if (classified.output.trim()) {
          console.log('cargo publish output:');
          console.log(classified.output);
        }
        return classified;
      },
      verify: () => verifyPublished(crateName, currentVersion),
      maxRetries: MAX_RETRIES,
      retryDelay: RETRY_DELAY,
      sleepFn: sleep,
      log: (message) => console.log(message),
      verifyOptions: VERIFY_OPTIONS,
      registryLabel: 'crates.io',
    });

    if (success) {
      setOutput('published', 'true');
      setOutput('published_version', currentVersion);
      console.log(`✅ Published ${crateName}@${currentVersion} to crates.io`);
      return;
    }

    // cargo accepted the upload but the crates.io index has not exposed it
    // within the polling window. Failing here would mark a completed release
    // as failed, so the accepted upload is reported as the outcome instead.
    if (error?.verificationFailed && uploadAccepted) {
      console.warn(
        `cargo publish succeeded but ${crateName}@${currentVersion} is not visible on crates.io yet; treating as published.`
      );
      setOutput('published', 'true');
      setOutput('published_version', currentVersion);
      return;
    }

    console.error(`❌ Publish failed: ${error.message}`);
    setOutput('published', 'false');
    process.exit(1);
  } catch (error) {
    console.error('Error:', error.message);
    setOutput('published', 'false');
    process.exit(1);
  }
}

main();
