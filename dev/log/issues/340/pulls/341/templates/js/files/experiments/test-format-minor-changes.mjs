#!/usr/bin/env bun

/**
 * Test script to validate format-release-notes.mjs with Minor Changes
 */

// Test Minor Changes pattern matching (mimics the actual v0.1.0 release)
const testBody = `### Minor Changes

- 65d76dc: Initial template setup with complete AI-driven development pipeline

  Features:
  - Multi-runtime support for Node.js, Bun, and Deno
  - Universal testing with test-anywhere framework
  - Automated release workflow with changesets
  - GitHub Actions CI/CD pipeline with 9 test combinations
  - Code quality tools: ESLint + Prettier with Husky pre-commit hooks
  - Package manager agnostic design`;

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

console.log('\n✅ Minor Changes test passed!');
