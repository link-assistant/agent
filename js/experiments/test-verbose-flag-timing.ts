/**
 * Experiment: Test if Flag.VERBOSE is true when getSDK() runs
 *
 * This simulates the exact call sequence:
 * 1. Flag starts as false (no env var)
 * 2. Middleware sets Flag.setVerbose(true)
 * 3. getSDK() runs and checks Flag.VERBOSE
 *
 * Run with: bun run experiments/test-verbose-flag-timing.ts
 */

import { Flag } from '../src/flag/flag.ts';

console.log('=== Test Flag.VERBOSE Timing ===\n');
console.log(`Initial VERBOSE: ${Flag.VERBOSE}`);

// Simulate what the middleware does
Flag.setVerbose(true);
console.log(`After setVerbose(true): ${Flag.VERBOSE}`);

// Simulate what getSDK() does
const shouldWrapFetch = Flag.VERBOSE;
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
console.log(`Direct Flag.VERBOSE: ${Flag.VERBOSE}`);

// Test if Flag module re-evaluation changes the value
const { VERBOSE } = await import('../src/flag/flag.ts');
console.log(`Destructured import: ${VERBOSE}`);
console.log(`Match: ${VERBOSE === Flag.VERBOSE}`);

if (VERBOSE !== Flag.VERBOSE) {
  console.log(
    '\n❌ BUG FOUND: Destructured import does NOT reflect setVerbose() change!'
  );
  console.log(
    'The issue is that "import { VERBOSE }" captures the value at import time,'
  );
  console.log('while Flag.VERBOSE uses the live binding.');
} else {
  console.log('\n✅ Both access paths return the same value');
}
