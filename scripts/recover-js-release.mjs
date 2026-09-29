#!/usr/bin/env node

/** Complete the GitHub release for a version already present on npm. */

import { execFile as execFileCallback } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { isPackageVersionPublished } from './npm-registry.mjs';
import { hasFormattedNpmBadge, npmVersionBadge } from './release-badge.mjs';

const execFile = promisify(execFileCallback);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Find the version bump commit so a late recovery tags the right tree. */
export function findVersionCommit(log, version) {
  for (const line of log.split('\n')) {
    const [sha, subject] = line.split('\0');
    if (subject === version && /^[a-f0-9]{40}$/.test(sha)) {
      return sha;
    }
  }
  throw new Error(`No version commit found for ${version}`);
}

/**
 * @param {object} options
 * @param {Function} options.isPublished
 * @param {Function} options.getRelease - returns release data or null
 * @param {Function} options.createRelease
 * @param {Function} options.formatRelease
 * @param {string} options.expectedBadge
 * @param {Function} [options.onPublished]
 * @returns {Promise<'needs_publish'|'complete'|'recovered'>}
 */
export async function recoverJsRelease({
  isPublished,
  getRelease,
  createRelease,
  formatRelease,
  expectedBadge,
  onPublished = () => {},
}) {
  if (!expectedBadge) {
    throw new Error('Expected npm version badge is required');
  }
  if (!(await isPublished())) {
    return 'needs_publish';
  }

  const release = await getRelease();
  if (release?.body && hasFormattedNpmBadge(release.body, expectedBadge)) {
    return 'complete';
  }

  // Record npm's state before the post-publish calls. This output remains
  // available to the workflow summary if either call fails.
  onPublished();
  if (!release) {
    await createRelease();
  }
  await formatRelease();
  return 'recovered';
}

function setOutput(key, value) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) {
    throw new Error('GITHUB_REPOSITORY is required');
  }

  const { name, version } = JSON.parse(
    readFileSync(join(repoRoot, 'js/package.json'), 'utf8')
  );
  const tag = `js-v${version}`;
  setOutput('current_version', version);
  const commonArgs = [
    '--release-version',
    version,
    '--repository',
    repository,
    '--prefix',
    'js-',
  ];

  const state = await recoverJsRelease({
    expectedBadge: npmVersionBadge(name, version),
    isPublished: () => isPackageVersionPublished(name, version),
    getRelease: async () => {
      try {
        const { stdout } = await execFile('gh', [
          'api',
          `repos/${repository}/releases/tags/${tag}`,
        ]);
        return JSON.parse(stdout);
      } catch (error) {
        if (String(error.stderr).includes('HTTP 404')) {
          return null;
        }
        throw error;
      }
    },
    onPublished: () => {
      setOutput('published', 'true');
      setOutput('published_version', version);
    },
    createRelease: async () => {
      const { stdout: log } = await execFile(
        'git',
        ['log', '--format=%H%x00%s', '--', 'js/package.json'],
        { cwd: repoRoot }
      );
      const target = findVersionCommit(log, version);
      const { stdout } = await execFile(
        process.execPath,
        [
          join(repoRoot, 'scripts/create-github-release.mjs'),
          ...commonArgs,
          '--target-commitish',
          target,
        ],
        { cwd: repoRoot }
      );
      console.log(stdout.trim());
    },
    formatRelease: async () => {
      const { stdout } = await execFile(
        process.execPath,
        [
          join(repoRoot, 'scripts/format-github-release.mjs'),
          ...commonArgs,
          '--commit-sha',
          process.env.GITHUB_SHA || '',
        ],
        { cwd: repoRoot }
      );
      console.log(stdout.trim());
    },
  });

  setOutput(state, 'true');
  console.log(`${tag}: ${state}`);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch((error) => {
    console.error('JS release recovery failed:', error.message);
    process.exitCode = 1;
  });
}
