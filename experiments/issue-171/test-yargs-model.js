#!/usr/bin/env bun
/**
 * Test script to verify yargs model parsing behavior
 * This investigates why --model kilo/glm-5-free might be ignored
 *
 * Issue: https://github.com/link-assistant/agent/issues/171
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

// Simulate the command: agent --model kilo/glm-5-free --verbose
const testArgs = ['--model', 'kilo/glm-5-free', '--verbose'];

console.log('Testing yargs model parsing...');
console.log('Test arguments:', testArgs);
console.log();

const argv = yargs(testArgs)
  .option('model', {
    type: 'string',
    description: 'Model to use in format providerID/modelID',
    default: 'opencode/kimi-k2.5-free',
  })
  .option('verbose', {
    type: 'boolean',
    default: false,
  })
  .parse();

console.log('Parsed argv:', JSON.stringify(argv, null, 2));
console.log();

// Now test the parseModelConfig logic
const modelArg = argv.model;
console.log('modelArg:', modelArg);
console.log('modelArg includes "/":', modelArg.includes('/'));

if (modelArg.includes('/')) {
  const modelParts = modelArg.split('/');
  let providerID = modelParts[0];
  let modelID = modelParts.slice(1).join('/');

  console.log('Before validation:');
  console.log('  providerID:', providerID, '(truthy:', Boolean(providerID), ')');
  console.log('  modelID:', modelID, '(truthy:', Boolean(modelID), ')');

  // This is the validation logic from the original code
  if (!providerID || !modelID) {
    providerID = providerID || 'opencode';
    modelID = modelID || 'kimi-k2.5-free';
    console.log('\nValidation fallback triggered!');
  }

  console.log('\nFinal result:');
  console.log('  providerID:', providerID);
  console.log('  modelID:', modelID);
}
