#!/usr/bin/env node

/**
 * Test script to verify shields.io badge URL generation
 *
 * This tests the fix for issue #123 where the badge URL was incorrectly
 * generated with the tag prefix (js-v0.8.4) instead of just the version (v0.8.4)
 *
 * Run: node experiments/test-badge-url.mjs
 */

const PACKAGE_NAME = '@link-assistant/agent';

// Test cases
const testCases = [
  { version: 'v0.8.4', description: 'Correct: version with v prefix only' },
  { version: 'js-v0.8.4', description: 'Incorrect: full tag with js- prefix' },
  { version: '0.8.4', description: 'Edge case: version without v prefix' },
  { version: 'rust-v1.0.0', description: 'Incorrect: full tag with rust- prefix' },
];

console.log('Testing shields.io badge URL generation\n');
console.log('='.repeat(80) + '\n');

for (const { version, description } of testCases) {
  // Current code logic
  const versionWithoutV = version.replace(/^v/, '');
  const badgeUrl = `https://img.shields.io/badge/npm-${versionWithoutV}-blue.svg`;
  const npmUrl = `https://www.npmjs.com/package/${PACKAGE_NAME}/v/${versionWithoutV}`;

  console.log(`Test: ${description}`);
  console.log(`  Input version: "${version}"`);
  console.log(`  After .replace(/^v/, ''): "${versionWithoutV}"`);
  console.log(`  Badge URL: ${badgeUrl}`);

  // Check if URL will work
  const parts = versionWithoutV.split('-');
  const isValid = parts.length === 1 || (parts.length === 3 && /^\d+$/.test(parts[0]));

  // A simple heuristic: if the version contains dashes that aren't part of semver,
  // shields.io will misinterpret it
  const hasProblem = /^[a-z]+-/.test(versionWithoutV);

  if (hasProblem) {
    console.log(`  Result: ❌ WILL FAIL - shields.io interprets dashes as delimiters`);
    console.log(`           Parsed as: LABEL="npm", MESSAGE="${parts[0]}", COLOR="${parts.slice(1).join('-')}"`);
  } else {
    console.log(`  Result: ✅ Should work correctly`);
  }
  console.log('');
}

console.log('='.repeat(80));
console.log('\nFix: Pass "v${version}" instead of "${tag}" to format-release-notes.mjs');
console.log('This ensures the version never has the prefix (js-, rust-) in the badge URL.');
