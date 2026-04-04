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

import { config, setVerbose } from '../src/flag/agent-config.ts';

console.log('=== Test config.verbose Timing ===\n');
console.log(`Initial verbose: ${config.verbose}`);

// Simulate what the middleware does
setVerbose(true);
console.log(`After setVerbose(true): ${config.verbose}`);

// Simulate what getSDK() does
const shouldWrapFetch = config.verbose;
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
console.log(`Direct config.verbose: ${config.verbose}`);

// Test if dynamic import re-evaluation changes the value
const { config: dynamicConfig } = await import('../src/flag/agent-config.ts');
console.log(`Dynamic import config.verbose: ${dynamicConfig.verbose}`);
console.log(`Match: ${dynamicConfig.verbose === config.verbose}`);

if (dynamicConfig.verbose !== config.verbose) {
  console.log(
    '\n❌ BUG FOUND: Dynamic import does NOT reflect setVerbose() change!'
  );
  console.log(
    'The issue is that dynamic import captures the value at import time,'
  );
  console.log('while config.verbose uses the live binding.');
} else {
  console.log('\n✅ Both access paths return the same value');
}
