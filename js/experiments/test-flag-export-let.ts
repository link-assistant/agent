/**
 * Experiment: Verify that `export let` in a TypeScript namespace
 * properly propagates changes across module boundaries in Bun.
 */

import { config, setVerbose } from '../src/flag/agent-config';

console.log('Initial config.verbose:', config.verbose);

// Simulate CLI middleware setting verbose
setVerbose(true);
console.log('After setVerbose(true):', config.verbose);

// Test closure behavior - simulate the fetch wrapper
const wrapper = () => {
  if (!config.verbose) {
    return 'verbose OFF - would skip logging';
  }
  return 'verbose ON - would log HTTP request';
};

console.log('Closure test (should be ON):', wrapper());

// Test toggling off
setVerbose(false);
console.log('After setVerbose(false):', config.verbose);
console.log('Closure test (should be OFF):', wrapper());

// Toggle back on
setVerbose(true);
console.log('After setVerbose(true) again:', config.verbose);
console.log('Closure test (should be ON):', wrapper());
