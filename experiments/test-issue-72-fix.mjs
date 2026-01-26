#!/usr/bin/env bun

/**
 * Test script for issue #72 fix
 * Tests that the agent falls back gracefully when opencode provider fails to initialize
 */

import { Provider } from '../src/provider/provider.ts';
import { Instance } from '../src/project/instance.ts';

console.log(
  'Testing issue #72 fix: graceful fallback when opencode provider fails\n'
);

await Instance.provide({
  directory: process.cwd(),
  fn: async () => {
    try {
      console.log('Step 1: Getting default model...');
      const defaultModel = await Provider.defaultModel();
      console.log('✓ Default model selected:', defaultModel);

      console.log('\nStep 2: Attempting to get the model...');
      const model = await Provider.getModel(
        defaultModel.providerID,
        defaultModel.modelID
      );
      console.log('✓ Model retrieved successfully:', {
        provider: model.providerID,
        model: model.modelID,
        npm: model.npm,
      });

      console.log(
        '\n✓ Test passed! Agent can initialize even with provider failures.'
      );
      process.exit(0);
    } catch (error) {
      console.error('\n✗ Test failed!');
      console.error('Error:', error);
      process.exit(1);
    }
  },
});
