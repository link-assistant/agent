#!/usr/bin/env node

/**
 * Collect changelog fragments into CHANGELOG.md for Rust
 * This script collects all .md files from rust/changelog.d/ (except README.md)
 * and prepends them to CHANGELOG.md, then removes the processed fragments.
 */

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  existsSync,
} from 'fs';
import { join } from 'path';

import {
  getRustRoot,
  getCargoTomlPath,
  getChangelogDir,
  getChangelogPath,
  parseRustRootConfig,
} from './rust-paths.mjs';

// Simple CLI argument parsing
const args = process.argv.slice(2);
const getArg = (name, defaultValue) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : defaultValue;
};

// Get Rust package root (auto-detect or use explicit config)
const rustRootConfig = getArg('rust-root', '') || parseRustRootConfig();
const rustRoot = getRustRoot({ rustRoot: rustRootConfig || undefined, verbose: true });

// Get paths based on detected/configured rust root
const CARGO_TOML = getCargoTomlPath({ rustRoot });
const CHANGELOG_DIR = getChangelogDir({ rustRoot });
const CHANGELOG_FILE = getChangelogPath({ rustRoot });
const INSERT_MARKER = '<!-- changelog-insert-here -->';

/**
 * Get version from Cargo.toml
 * @returns {string}
 */
function getVersionFromCargo() {
  const cargoToml = readFileSync(CARGO_TOML, 'utf-8');
  const match = cargoToml.match(/^version\s*=\s*"([^"]+)"/m);

  if (!match) {
    console.error(`Error: Could not find version in ${CARGO_TOML}`);
    process.exit(1);
  }

  return match[1];
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
 * Collect all changelog fragments
 * @returns {string}
 */
function collectFragments() {
  if (!existsSync(CHANGELOG_DIR)) {
    return '';
  }

  const files = readdirSync(CHANGELOG_DIR)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .sort();

  const fragments = [];
  for (const file of files) {
    const rawContent = readFileSync(join(CHANGELOG_DIR, file), 'utf-8');
    // Strip frontmatter (which contains bump type metadata)
    const content = stripFrontmatter(rawContent);
    if (content) {
      fragments.push(content);
    }
  }

  return fragments.join('\n\n');
}

/**
 * Update CHANGELOG.md with collected fragments
 * @param {string} version
 * @param {string} fragments
 */
function updateChangelog(version, fragments) {
  const dateStr = new Date().toISOString().split('T')[0];
  const newEntry = `\n## [${version}] - ${dateStr}\n\n${fragments}\n`;

  if (existsSync(CHANGELOG_FILE)) {
    let content = readFileSync(CHANGELOG_FILE, 'utf-8');

    if (content.includes(INSERT_MARKER)) {
      content = content.replace(INSERT_MARKER, `${INSERT_MARKER}${newEntry}`);
    } else {
      // Insert after the first ## heading
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
        // Append after the main heading
        content += newEntry;
      }
    }

    writeFileSync(CHANGELOG_FILE, content, 'utf-8');
  } else {
    const content = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

${INSERT_MARKER}
${newEntry}
`;
    writeFileSync(CHANGELOG_FILE, content, 'utf-8');
  }

  console.log(`Updated CHANGELOG.md with version ${version}`);
}

/**
 * Remove processed changelog fragments
 */
function removeFragments() {
  if (!existsSync(CHANGELOG_DIR)) {
    return;
  }

  const files = readdirSync(CHANGELOG_DIR).filter(
    (f) => f.endsWith('.md') && f !== 'README.md'
  );

  for (const file of files) {
    const filePath = join(CHANGELOG_DIR, file);
    unlinkSync(filePath);
    console.log(`Removed ${filePath}`);
  }
}

try {
  const version = getVersionFromCargo();
  console.log(`Collecting changelog fragments for version ${version}`);

  const fragments = collectFragments();

  if (!fragments) {
    console.log('No changelog fragments found');
    process.exit(0);
  }

  updateChangelog(version, fragments);
  removeFragments();

  console.log('Changelog collection complete');
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
