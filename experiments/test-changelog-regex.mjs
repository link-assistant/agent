#!/usr/bin/env node

/**
 * Test that the changelog version regex works for both JS and Rust formats
 */

const jsChangelog = `# @link-assistant/agent

## 0.22.0

### Minor Changes

- feat: add --temperature CLI option

## 0.21.0

### Minor Changes

- feat: replace deprecated model
`;

const rustChangelog = `# Changelog

All notable changes to this project will be documented in this file.

## [0.8.0] - 2026-04-11

### Added

- Separate CI/CD pipelines for JS and Rust code

### Added

- Added \`--temperature\` CLI option

## [0.7.0] - 2026-01-01

### Added

- Initial release
`;

function extractReleaseNotes(changelog, version) {
  const escapedVersion = version.replace(/\./g, '\\.');
  const versionHeaderRegex = new RegExp(
    `## \\[?${escapedVersion}\\]?[^\\n]*\\n([\\s\\S]*?)(?=## [\\[\\d]|$)`
  );
  const match = changelog.match(versionHeaderRegex);
  return match ? match[1].trim() : null;
}

// Test JS format
const jsNotes = extractReleaseNotes(jsChangelog, '0.22.0');
console.log('=== JS format (## 0.22.0) ===');
console.log('Match:', jsNotes !== null ? 'YES' : 'NO');
console.log('Notes:', jsNotes);
console.log();

// Test Rust format
const rustNotes = extractReleaseNotes(rustChangelog, '0.8.0');
console.log('=== Rust format (## [0.8.0] - date) ===');
console.log('Match:', rustNotes !== null ? 'YES' : 'NO');
console.log('Notes:', rustNotes);
console.log();

// Test non-existent version
const missingNotes = extractReleaseNotes(rustChangelog, '0.9.0');
console.log('=== Non-existent version ===');
console.log('Match:', missingNotes !== null ? 'YES' : 'NO');
console.log();

// Verify old regex would fail for Rust format
function oldExtract(changelog, version) {
  const versionHeaderRegex = new RegExp(`## ${version}[\\s\\S]*?(?=## \\d|$)`);
  const match = changelog.match(versionHeaderRegex);
  return match ? match[0].replace(`## ${version}`, '').trim() : null;
}

const oldRustNotes = oldExtract(rustChangelog, '0.8.0');
console.log('=== Old regex on Rust format (should fail) ===');
console.log('Match:', oldRustNotes !== null ? 'YES' : 'NO');

// Summary
const allPassed = jsNotes !== null && rustNotes !== null && missingNotes === null && oldRustNotes === null;
console.log(`\n${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
process.exit(allPassed ? 0 : 1);
