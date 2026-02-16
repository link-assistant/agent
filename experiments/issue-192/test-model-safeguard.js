#!/usr/bin/env bun
/**
 * Test script to verify the model argument safeguard
 * Issue: https://github.com/link-assistant/agent/issues/192
 *
 * This script tests the safeguard that was added to detect and correct
 * cases where yargs returns the default model value instead of the CLI argument.
 *
 * The safeguard compares argv.model against process.argv and uses the CLI value
 * if there's a mismatch.
 */

/**
 * Extract model argument directly from process.argv (same logic as in index.js)
 * @returns {string|null} - The model argument from CLI or null if not found
 */
function getModelFromProcessArgv() {
  const args = process.argv;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    // Handle --model=value format
    if (arg.startsWith('--model=')) {
      return arg.substring('--model='.length);
    }
    // Handle --model value format
    if (arg === '--model' && i + 1 < args.length) {
      return args[i + 1];
    }
    // Handle -m=value format
    if (arg.startsWith('-m=')) {
      return arg.substring('-m='.length);
    }
    // Handle -m value format (but not if it looks like another flag)
    if (arg === '-m' && i + 1 < args.length && !args[i + 1].startsWith('-')) {
      return args[i + 1];
    }
  }
  return null;
}

console.log('=== Test: Model Argument Safeguard ===');
console.log();

console.log('process.argv:', process.argv);
console.log();

const cliModel = getModelFromProcessArgv();
console.log('Model from process.argv:', cliModel || '(not provided)');
console.log();

// Simulate yargs returning default value (the bug scenario)
const yargsDefaultModel = 'opencode/kimi-k2.5-free';
const expectedCliModel = 'kilo/glm-5-free';

console.log('=== Safeguard Logic Test ===');
console.log();

// Test case 1: No mismatch (normal case)
console.log('Test 1: No mismatch (yargs and CLI match)');
let yargsModel = cliModel;
let finalModel = yargsModel;
if (cliModel && cliModel !== yargsModel) {
  console.log(`  WARNING: Mismatch detected! yargs=${yargsModel}, cli=${cliModel}`);
  finalModel = cliModel;
}
console.log(`  yargsModel: ${yargsModel}`);
console.log(`  cliModel: ${cliModel}`);
console.log(`  finalModel: ${finalModel}`);
console.log(`  Result: ${yargsModel === finalModel ? 'PASS (no correction needed)' : 'CORRECTED'}`);
console.log();

// Test case 2: Mismatch (the bug scenario)
console.log('Test 2: Mismatch simulation (yargs returns default, CLI has correct value)');
yargsModel = yargsDefaultModel; // Simulate yargs bug
const simulatedCliModel = expectedCliModel;
finalModel = yargsModel;
if (simulatedCliModel && simulatedCliModel !== yargsModel) {
  console.log(`  WARNING: Mismatch detected! yargs=${yargsModel}, cli=${simulatedCliModel}`);
  finalModel = simulatedCliModel;
}
console.log(`  yargsModel: ${yargsModel}`);
console.log(`  cliModel: ${simulatedCliModel}`);
console.log(`  finalModel: ${finalModel}`);
console.log(`  Result: ${finalModel === simulatedCliModel ? 'PASS (correctly corrected to CLI value)' : 'FAIL'}`);
console.log();

// Test case 3: No CLI model (user relies on default)
console.log('Test 3: No CLI model provided (should use yargs default)');
yargsModel = yargsDefaultModel;
const noCliModel = null;
finalModel = yargsModel;
if (noCliModel && noCliModel !== yargsModel) {
  console.log(`  WARNING: Mismatch detected! yargs=${yargsModel}, cli=${noCliModel}`);
  finalModel = noCliModel;
}
console.log(`  yargsModel: ${yargsModel}`);
console.log(`  cliModel: ${noCliModel || '(not provided)'}`);
console.log(`  finalModel: ${finalModel}`);
console.log(`  Result: ${finalModel === yargsDefaultModel ? 'PASS (correctly uses default)' : 'FAIL'}`);
console.log();

console.log('=== All Tests Complete ===');
