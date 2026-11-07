#!/usr/bin/env bun

/**
 * Test script to validate format-release-notes.mjs without commit hash
 */

// Test without commit hash
const testBody = `### Minor Changes

- Add new feature for improved performance`;

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
  console.log(`   Description: ${rawDescription}`);

  // Verify that no commit hash is extracted (as expected)
  if (!commitHash && rawDescription) {
    const descWithHashMatch = rawDescription.match(/^([a-f0-9]+):\s+(.+)$/s);
    if (descWithHashMatch) {
      console.log('❌ Unexpected hash extraction from plain description');
      process.exit(1);
    } else {
      console.log('   ✅ Correctly handled description without hash');
    }
  }
} else {
  console.log('❌ Pattern did not match');
  process.exit(1);
}

console.log('\n✅ No-hash test passed!');
