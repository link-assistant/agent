/**
 * Experiment: Verify that `export let` in a TypeScript namespace
 * properly propagates changes across module boundaries in Bun.
 */

import { Flag } from '../src/flag/flag';

console.log('Initial Flag.VERBOSE:', Flag.VERBOSE);

// Simulate CLI middleware setting verbose
Flag.setVerbose(true);
console.log('After setVerbose(true):', Flag.VERBOSE);

// Test closure behavior - simulate the fetch wrapper
const wrapper = () => {
  if (!Flag.VERBOSE) {
    return 'verbose OFF - would skip logging';
  }
  return 'verbose ON - would log HTTP request';
};

console.log('Closure test (should be ON):', wrapper());

// Test toggling off
Flag.setVerbose(false);
console.log('After setVerbose(false):', Flag.VERBOSE);
console.log('Closure test (should be OFF):', wrapper());

// Toggle back on
Flag.setVerbose(true);
console.log('After setVerbose(true) again:', Flag.VERBOSE);
console.log('Closure test (should be ON):', wrapper());
