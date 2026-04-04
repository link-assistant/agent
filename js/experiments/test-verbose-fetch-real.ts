/**
 * Experiment: Test verbose HTTP logging by actually making an API call
 * Related to: https://github.com/link-assistant/agent/issues/215
 */

import { config, setVerbose } from '../src/config/config';
import { Log } from '../src/util/log';
import { Instance } from '../src/project/instance';
import { Provider } from '../src/provider/provider';
import { generateText } from 'ai';

// Enable verbose
setVerbose(true);

// Init logging
await Log.init({
  print: true,
  level: 'DEBUG',
});

console.error('[TEST] Verbose mode enabled');

await Instance.provide({
  directory: process.cwd(),
  fn: async () => {
    try {
      // Get the opencode model - this will use the opencode provider with bundled @ai-sdk/anthropic
      const model = await Provider.getModel('opencode', 'minimax-m2.5-free');
      console.error(
        '[TEST] Model obtained:',
        model?.providerID,
        model?.modelID
      );

      // Actually call the model - this should trigger the verbose fetch wrapper
      console.error('[TEST] Calling generateText...');
      const result = await generateText({
        model: model!.language,
        prompt: 'Say just the word "hello" and nothing else.',
        maxTokens: 10,
      });
      console.error('[TEST] Result:', result.text);
    } catch (e) {
      console.error('[TEST] Error:', (e as Error).message);
      // Even on error, we should see HTTP request logs
    }
  },
});

console.error('[TEST] === DONE ===');
process.exit(0);
