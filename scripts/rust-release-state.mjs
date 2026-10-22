#!/usr/bin/env node

/**
 * Decide whether the Rust Auto Release job has work to do.
 *
 * A release has three parts: the `rust-vX.Y.Z` tag, the crate on crates.io
 * and the GitHub release. The workflow used to read an unreachable crates.io
 * as "not published", ended green with "appears fully released" when the tag
 * and the GitHub release existed but the crate did not, and created a GitHub
 * release for a bare tag without publishing the crate (issue #337). Here any
 * missing part sends the job through the publish and release steps, which
 * both skip work that is already done, and an unknown crates.io state fails
 * the job instead of guessing.
 *
 * CLI (writes should_release/skip_bump to $GITHUB_OUTPUT and stdout):
 *   HAS_FRAGMENTS=true|false node scripts/rust-release-state.mjs \
 *     --repository <owner/repo> [--rust-root <path>]
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isCrateVersionPublished } from './crates-registry.mjs';
import { readCrateInfo } from './rust-package-info.mjs';
import { getRustRoot, parseRustRootConfig } from './rust-paths.mjs';

/**
 * @param {object} state
 * @param {boolean} state.hasFragments - unreleased changelog fragments exist
 * @param {boolean} state.tagExists
 * @param {boolean} state.releaseExists - the GitHub release exists
 * @param {boolean} state.cratePublished
 * @returns {{shouldRelease: boolean, skipBump: boolean, reason: string}}
 */
export function decideRustRelease({
  hasFragments,
  tagExists,
  releaseExists,
  cratePublished,
}) {
  if (hasFragments) {
    return {
      shouldRelease: true,
      skipBump: false,
      reason: 'changelog fragments found, releasing a new version',
    };
  }
  if (tagExists && releaseExists && cratePublished) {
    return {
      shouldRelease: false,
      skipBump: false,
      reason: 'fully released (tag, GitHub release and crates.io)',
    };
  }
  const missing = [
    !tagExists && 'tag',
    !cratePublished && 'crates.io version',
    !releaseExists && 'GitHub release',
  ].filter(Boolean);
  return {
    shouldRelease: true,
    skipBump: true,
    reason: `completing the current version, missing: ${missing.join(', ')}`,
  };
}

/**
 * Look the version up on crates.io, retrying transient failures. Throws when
 * crates.io never answers with a definite 200 or 404.
 */
export async function readCratePublished(
  crateName,
  version,
  { lookup = isCrateVersionPublished, attempts = 3, delayMs = 2000 } = {}
) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await lookup(crateName, version);
    } catch (error) {
      lastError = error;
      console.log(
        `crates.io lookup failed (attempt ${attempt}/${attempts}): ${error.message}`
      );
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }
  throw new Error(
    `Cannot tell whether ${crateName}@${version} is on crates.io: ${lastError.message}`
  );
}

function succeeds(command, args) {
  try {
    execFileSync(command, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function setOutput(key, value) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
  console.log(`Output: ${key}=${value}`);
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name, defaultValue) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 && args[index + 1] ? args[index + 1] : defaultValue;
  };
  const repository = getArg('repository', process.env.GITHUB_REPOSITORY);
  if (!repository) {
    throw new Error('--repository or GITHUB_REPOSITORY is required');
  }
  const rustRoot = getRustRoot({
    rustRoot: getArg('rust-root', '') || parseRustRootConfig() || undefined,
  });
  const { name, version } = readCrateInfo({ rustRoot });
  const tag = `rust-v${version}`;

  const state = {
    hasFragments: process.env.HAS_FRAGMENTS === 'true',
    tagExists: succeeds('git', ['rev-parse', '--verify', '--quiet', tag]),
    releaseExists: succeeds('gh', [
      'api',
      `repos/${repository}/releases/tags/${tag}`,
      '--silent',
    ]),
    cratePublished: await readCratePublished(name, version),
  };
  console.log(`${name}@${version}:`, state);

  const decision = decideRustRelease(state);
  console.log(`Decision: ${decision.reason}`);
  setOutput('should_release', String(decision.shouldRelease));
  setOutput('skip_bump', String(decision.skipBump));
}

if (
  process.argv?.[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main().catch((error) => {
    console.error(`::error title=Rust release state unknown::${error.message}`);
    process.exit(1);
  });
}
