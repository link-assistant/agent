#!/usr/bin/env bun

/**
 * Test script to validate format-release-notes.mjs with Patch Changes
 */

// Test Patch Changes pattern matching
const testBody = `### Patch Changes

- def5678: Fix issue with error handling in release script

  This patch fixes a bug where the script would crash on empty descriptions.`;

// The pattern from our fixed script
const changesPattern =
  /### (Major|Minor|Patch) Changes\s*\n\s*-\s+(?:([a-f0-9]+):\s+)?(.+?)$/s;
const changesMatch = testBody.match(changesPattern);

let commitHash;
let rawDescription;
let changeType;

if (changesMatch) {
  [, changeType, commitHash, rawDescription] = changesMatch;
  console.log(`✅ Pattern matched successfully`);
  console.log(`   Change Type: ${changeType}`);
  console.log(`   Commit Hash: ${commitHash || 'none'}`);
  console.log(`   Description: ${rawDescription.substring(0, 50)}...`);

  // If commitHash is undefined and description contains it, try to extract
  if (!commitHash && rawDescription) {
    const descWithHashMatch = rawDescription.match(/^([a-f0-9]+):\s+(.+)$/s);
    if (descWithHashMatch) {
      [, commitHash, rawDescription] = descWithHashMatch;
      console.log(`   Extracted Hash: ${commitHash}`);
      console.log(
        `   Cleaned Description: ${rawDescription.substring(0, 50)}...`
      );
    }
  }
} else {
  console.log('❌ Pattern did not match');
  process.exit(1);
}

console.log('\n✅ Patch Changes test passed!');
