#!/usr/bin/env node

/**
 * Bump version in Cargo.toml and commit changes for Rust
 * Used by the CI/CD pipeline for releases
 *
 * Usage: node scripts/rust-version-and-commit.mjs --bump-type <major|minor|patch> [--description <desc>]
 */

import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  readdirSync,
  existsSync,
  unlinkSync,
} from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

// Simple CLI argument parsing
const args = process.argv.slice(2);
const getArg = (name, defaultValue) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : defaultValue;
};

const bumpType = getArg('bump-type', process.env.BUMP_TYPE || '');
const description = getArg('description', process.env.DESCRIPTION || '');

if (!bumpType || !['major', 'minor', 'patch'].includes(bumpType)) {
  console.error(
    'Usage: node scripts/rust-version-and-commit.mjs --bump-type <major|minor|patch> [--description <desc>]'
  );
  process.exit(1);
}

const CARGO_TOML = 'rust/Cargo.toml';
const CHANGELOG_DIR = 'rust/changelog.d';
const CHANGELOG_FILE = 'rust/CHANGELOG.md';

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
  // Also log for visibility
  console.log(`Output: ${key}=${value}`);
}

/**
 * Execute a shell command
 * @param {string} command
 * @returns {string}
 */
function exec(command) {
  try {
    return execSync(command, { encoding: 'utf-8', stdio: 'pipe' }).trim();
  } catch (error) {
    if (error.status !== undefined) {
      throw error;
    }
    return '';
  }
}

/**
 * Get current version from Cargo.toml
 * @returns {{major: number, minor: number, patch: number}}
 */
function getCurrentVersion() {
  const cargoToml = readFileSync(CARGO_TOML, 'utf-8');
  const match = cargoToml.match(/^version\s*=\s*"(\d+)\.(\d+)\.(\d+)"/m);

  if (!match) {
    console.error('Error: Could not parse version from Cargo.toml');
    process.exit(1);
  }

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

/**
 * Calculate new version based on bump type
 * @param {{major: number, minor: number, patch: number}} current
 * @param {string} bumpType
 * @returns {string}
 */
function calculateNewVersion(current, bumpType) {
  const { major, minor, patch } = current;

  switch (bumpType) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Invalid bump type: ${bumpType}`);
  }
}

/**
 * Update version in Cargo.toml
 * @param {string} newVersion
 */
function updateCargoToml(newVersion) {
  let cargoToml = readFileSync(CARGO_TOML, 'utf-8');
  cargoToml = cargoToml.replace(
    /^(version\s*=\s*")[^"]+(")/m,
    `$1${newVersion}$2`
  );
  writeFileSync(CARGO_TOML, cargoToml, 'utf-8');
  console.log(`Updated Cargo.toml to version ${newVersion}`);
}

/**
 * Check if a git tag exists for this version
 * @param {string} version
 * @returns {boolean}
 */
function checkTagExists(version) {
  try {
    exec(`git rev-parse rust-v${version}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Strip frontmatter from markdown content
 * @param {string} content - Markdown content potentially with frontmatter
 * @returns {string} - Content without frontmatter
 */
function stripFrontmatter(content) {
  const frontmatterMatch = content.match(
    /^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/
  );
  if (frontmatterMatch) {
    return frontmatterMatch[1].trim();
  }
  return content.trim();
}

/**
 * Collect changelog fragments and update CHANGELOG.md
 * @param {string} version
 */
function collectChangelog(version) {
  if (!existsSync(CHANGELOG_DIR)) {
    return;
  }

  const files = readdirSync(CHANGELOG_DIR).filter(
    (f) => f.endsWith('.md') && f !== 'README.md'
  );

  if (files.length === 0) {
    return;
  }

  const fragments = files
    .sort()
    .map((f) => {
      const rawContent = readFileSync(join(CHANGELOG_DIR, f), 'utf-8');
      // Strip frontmatter (which contains bump type metadata)
      return stripFrontmatter(rawContent);
    })
    .filter(Boolean)
    .join('\n\n');

  if (!fragments) {
    return;
  }

  const dateStr = new Date().toISOString().split('T')[0];
  const newEntry = `\n## [${version}] - ${dateStr}\n\n${fragments}\n`;

  if (existsSync(CHANGELOG_FILE)) {
    let content = readFileSync(CHANGELOG_FILE, 'utf-8');
    const lines = content.split('\n');
    let insertIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('## [')) {
        insertIndex = i;
        break;
      }
    }

    if (insertIndex >= 0) {
      lines.splice(insertIndex, 0, newEntry);
      content = lines.join('\n');
    } else {
      content += newEntry;
    }

    writeFileSync(CHANGELOG_FILE, content, 'utf-8');
  } else {
    const content = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

${newEntry}
`;
    writeFileSync(CHANGELOG_FILE, content, 'utf-8');
  }

  console.log(`Collected ${files.length} changelog fragment(s)`);

  // Remove processed fragments
  for (const file of files) {
    const filePath = join(CHANGELOG_DIR, file);
    unlinkSync(filePath);
    console.log(`Removed ${filePath}`);
  }
}

async function main() {
  try {
    // Configure git
    exec('git config user.name "github-actions[bot]"');
    exec(
      'git config user.email "github-actions[bot]@users.noreply.github.com"'
    );

    const current = getCurrentVersion();
    const newVersion = calculateNewVersion(current, bumpType);

    // Check if this version was already released
    if (checkTagExists(newVersion)) {
      console.log(`Tag rust-v${newVersion} already exists`);
      setOutput('already_released', 'true');
      setOutput('new_version', newVersion);
      return;
    }

    // Update version in Cargo.toml
    updateCargoToml(newVersion);

    // Collect changelog fragments
    collectChangelog(newVersion);

    // Stage files
    exec(`git add ${CARGO_TOML}`);
    if (existsSync(CHANGELOG_FILE)) {
      exec(`git add ${CHANGELOG_FILE}`);
    }
    exec(`git add ${CHANGELOG_DIR} || true`);

    // Check if there are changes to commit
    try {
      exec('git diff --cached --quiet');
      // No changes to commit
      console.log('No changes to commit');
      setOutput('version_committed', 'false');
      setOutput('new_version', newVersion);
      return;
    } catch {
      // There are changes to commit (git diff exits with 1 when there are differences)
    }

    // Commit changes
    const commitMsg = description
      ? `chore(rust): release v${newVersion}\n\n${description}`
      : `chore(rust): release v${newVersion}`;
    exec(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`);
    console.log(`Committed version ${newVersion}`);

    // Create tag
    const tagMsg = description
      ? `Rust Release v${newVersion}\n\n${description}`
      : `Rust Release v${newVersion}`;
    exec(`git tag -a rust-v${newVersion} -m "${tagMsg.replace(/"/g, '\\"')}"`);
    console.log(`Created tag rust-v${newVersion}`);

    // Push changes and tag
    exec('git push');
    exec('git push --tags');
    console.log('Pushed changes and tags');

    setOutput('version_committed', 'true');
    setOutput('new_version', newVersion);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
