/**
 * Experiment: End-to-end test of verbose HTTP logging via Provider.getModel()
 * Simulates the actual production code path to check if HTTP logs appear.
 *
 * Issue: https://github.com/link-assistant/agent/issues/215
 */

import { config, setVerbose } from '../src/config/config';
import { Log } from '../src/util/log';

// Set verbose mode BEFORE anything else (like middleware does)
setVerbose(true);

// Initialize logging (like middleware does)
await Log.init({
  print: true,
  level: 'DEBUG',
});

console.log(`config.verbose = ${config.verbose}`);

// Now simulate what getSDK does
import { createAnthropic } from '@ai-sdk/anthropic';

const log = Log.create({ service: 'provider' });

// Simulate the exact options flow from getSDK
const options: Record<string, any> = {
  apiKey: 'test-key-12345678',
  baseURL: 'https://api.opencode.ai/v1', // opencode proxy
};

// Step 1: RetryFetch wrapper (simplified)
const existingFetch = options['fetch'] ?? fetch;
options['fetch'] = async (input: any, init?: any) => {
  console.log('[RetryFetch] passing through');
  return existingFetch(input, init);
};

// Step 2: Verbose HTTP logging wrapper (exact copy from provider.ts)
{
  const innerFetch = options['fetch'];
  let verboseWrapperConfirmed = false;
  options['fetch'] = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    // Check verbose flag at call time
    if (!config.verbose) {
      console.log('[VerboseWrapper] Flag is FALSE, skipping');
      return innerFetch(input, init);
    }

    if (!verboseWrapperConfirmed) {
      verboseWrapperConfirmed = true;
      log.info('verbose HTTP logging active', { providerID: 'opencode' });
    }

    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as any).url;
    const method = init?.method ?? 'GET';

    log.info('HTTP request', {
      providerID: 'opencode',
      method,
      url,
    });

    // Return mock Anthropic response
    return new Response(
      JSON.stringify({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello' }],
        model: 'minimax-m2.5-free',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }
    );
  };
}

// Step 3: Create SDK (like getSDK does with bundledFn)
const sdk = createAnthropic({
  name: 'opencode',
  ...options,
});

// Step 4: Get language model
const model = sdk.languageModel('minimax-m2.5-free');

console.log('\n=== Making API call via SDK ===\n');

try {
  const result = await model.doGenerate({
    inputFormat: 'messages',
    mode: { type: 'regular' },
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
  });
  console.log(
    `\nGeneration result: ${JSON.stringify(result.text).slice(0, 100)}`
  );
} catch (e: any) {
  console.log(`\nError: ${e.message}`);
}

console.log('\n=== Done ===');
