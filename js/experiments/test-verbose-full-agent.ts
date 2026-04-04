/**
 * Experiment: Test verbose HTTP logging through the full agent stack
 * Uses the echo provider to avoid needing real API keys
 * Related to: https://github.com/link-assistant/agent/issues/215
 */

import { Flag } from '../src/flag/flag';
import { Log } from '../src/util/log';
import { Instance } from '../src/project/instance';
import { Provider } from '../src/provider/provider';

// Enable verbose
Flag.setVerbose(true);

// Init logging
await Log.init({
  print: true,
  level: 'DEBUG',
});

console.error('[TEST] Verbose mode enabled, Log initialized');
console.error('[TEST] Flag.VERBOSE =', Flag.VERBOSE);

// Create instance
await Instance.provide({
  directory: process.cwd(),
  fn: async () => {
    console.error('[TEST] Inside Instance.provide');

    // Try to get the opencode provider and minimax model
    try {
      const providers = await Provider.list();
      console.error('[TEST] Available providers:', Object.keys(providers));

      const opencode = providers['opencode'];
      if (opencode) {
        console.error('[TEST] opencode provider found');
        console.error(
          '[TEST] opencode provider options:',
          JSON.stringify(opencode.options)
        );
        console.error(
          '[TEST] opencode provider models:',
          Object.keys(opencode.info.models).slice(0, 5)
        );
      } else {
        console.error('[TEST] opencode provider NOT found');
      }

      // Try to get the SDK
      const state = await Provider.state();
      console.error('[TEST] SDK cache size:', state.sdk.size);

      // Try to get a model to trigger SDK creation
      try {
        const model = await Provider.getModel('opencode', 'minimax-m2.5-free');
        console.error(
          '[TEST] Model obtained:',
          model?.providerID,
          model?.modelID
        );
        console.error('[TEST] SDK cache size after model:', state.sdk.size);

        // Check if the SDK has a custom fetch
        for (const [key, sdk] of state.sdk) {
          console.error('[TEST] SDK key:', key);
          // The SDK is the result of createAnthropic(), check if it has fetch
          console.error('[TEST] SDK type:', typeof sdk);
        }
      } catch (e) {
        console.error('[TEST] getModel error:', (e as Error).message);
      }
    } catch (e) {
      console.error('[TEST] Error:', (e as Error).message);
    }
  },
});

console.error('[TEST] === DONE ===');
process.exit(0);
