/**
 * Experiment: Test if Flag.OPENCODE_VERBOSE is true when getSDK() runs
 *
 * This simulates the exact call sequence:
 * 1. Flag starts as false (no env var)
 * 2. Middleware sets Flag.setVerbose(true)
 * 3. getSDK() runs and checks Flag.OPENCODE_VERBOSE
 *
 * Run with: bun run experiments/test-verbose-flag-timing.ts
 */

import { Flag } from '../src/flag/flag.ts';

console.log('=== Test Flag.OPENCODE_VERBOSE Timing ===\n');
console.log(`Initial OPENCODE_VERBOSE: ${Flag.OPENCODE_VERBOSE}`);

// Simulate what the middleware does
Flag.setVerbose(true);
console.log(`After setVerbose(true): ${Flag.OPENCODE_VERBOSE}`);

// Simulate what getSDK() does
const shouldWrapFetch = Flag.OPENCODE_VERBOSE;
console.log(`Should wrap fetch (in getSDK): ${shouldWrapFetch}`);

if (shouldWrapFetch) {
  console.log('\n✅ PASS: Verbose flag IS true when getSDK check runs');
  console.log('The bug is NOT in the flag timing.');
} else {
  console.log('\n❌ FAIL: Verbose flag is false when getSDK check runs');
  console.log('The bug IS in the flag timing!');
}

// Additional test: check the exported let behavior
console.log('\n=== Test exported let behavior ===');
console.log(`Direct Flag.OPENCODE_VERBOSE: ${Flag.OPENCODE_VERBOSE}`);

// Test if Flag module re-evaluation changes the value
const { OPENCODE_VERBOSE } = await import('../src/flag/flag.ts');
console.log(`Destructured import: ${OPENCODE_VERBOSE}`);
console.log(`Match: ${OPENCODE_VERBOSE === Flag.OPENCODE_VERBOSE}`);

if (OPENCODE_VERBOSE !== Flag.OPENCODE_VERBOSE) {
  console.log(
    '\n❌ BUG FOUND: Destructured import does NOT reflect setVerbose() change!'
  );
  console.log(
    'The issue is that "import { OPENCODE_VERBOSE }" captures the value at import time,'
  );
  console.log('while Flag.OPENCODE_VERBOSE uses the live binding.');
} else {
  console.log('\n✅ Both access paths return the same value');
}
