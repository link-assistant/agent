/**
 * Experiment: Test the EXACT production chain including global monkey-patch
 *
 * Simulates the full production flow:
 * 1. Flag.setVerbose(true)
 * 2. Log.init()
 * 3. Global fetch monkey-patch via createVerboseFetch
 * 4. getSDK creates provider with fetch chain
 * 5. SDK makes API call
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { Flag } from '../src/flag/flag';
import {
  createVerboseFetch,
  resetHttpCallCount,
  getHttpCallCount,
} from '../src/util/verbose-fetch';
import { Log } from '../src/util/log';

// Step 1: Set verbose (like middleware line 777)
Flag.setVerbose(true);

// Step 2: Init logging (like middleware line 799)
await Log.init({
  print: true,
  level: 'DEBUG',
  compactJson: false,
});

// Step 3: Global monkey-patch (like middleware line 807-812)
const preMonkeyPatchFetch = globalThis.fetch;
globalThis.fetch = createVerboseFetch(globalThis.fetch, { caller: 'global' });
(globalThis as any).__agentVerboseFetchInstalled = true;
resetHttpCallCount();

console.log('\n=== Setup ===');
console.log('Flag.VERBOSE:', Flag.VERBOSE);
console.log(
  '__agentVerboseFetchInstalled:',
  (globalThis as any).__agentVerboseFetchInstalled
);

// Step 4: Simulate getSDK (provider.ts lines 1152-1500)
const options: Record<string, any> = { apiKey: 'test-key' }; // opencode options

// Line 1199: existingFetch
const existingFetch = options['fetch'] ?? fetch;
console.log(
  'existingFetch is monkey-patched globalThis.fetch:',
  existingFetch === globalThis.fetch
);

// Line 1200: RetryFetch wrapping (simplified - just passthrough)
const retryFetch = async (input: any, init?: any) => existingFetch(input, init);
options['fetch'] = retryFetch;

// Line 1216-1222: Log fetch chain config
console.log(
  'globalVerboseFetchInstalled:',
  !!(globalThis as any).__agentVerboseFetchInstalled
);
console.log('verboseAtCreation:', Flag.VERBOSE);

// Line 1224-1481: Provider-level verbose wrapper
const innerFetch = options['fetch'];
options['fetch'] = async (input: any, init?: any) => {
  // Line 1233-1237: Skip if verbose is off OR global patch is installed
  if (!Flag.VERBOSE || (globalThis as any).__agentVerboseFetchInstalled) {
    return innerFetch(input, init);
  }
  console.log(
    '[PROVIDER WRAPPER] This should NOT appear when global patch is installed'
  );
  return innerFetch(input, init);
};

// Step 5: Create SDK with the wrapped fetch
const anthropic = createAnthropic({
  name: 'opencode',
  ...options,
});

// Override the response to avoid actual API calls
const model = anthropic('minimax-m2.5-free');

// Intercept at the lowest level to return fake response
const originalFetch = preMonkeyPatchFetch;
const fakeResponseFetch = createVerboseFetch(
  async (input: any, init?: any) => {
    console.log('\n[INNER FETCH - actual network call would happen here]');
    return new Response(
      JSON.stringify({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'test response' }],
        model: 'minimax-m2.5-free',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  },
  { caller: 'global' }
);

// Replace global fetch with our fake to prevent actual API calls
// but still go through the verbose wrapper
globalThis.fetch = fakeResponseFetch;

console.log('\n=== Making API call through SDK ===');
resetHttpCallCount();

try {
  await model.doGenerate({
    inputFormat: 'prompt',
    mode: { type: 'regular' },
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  });
  console.log('\n=== Call completed ===');
} catch (e: any) {
  console.log('\nError:', e.message?.slice(0, 200));
}

console.log('HTTP call count:', getHttpCallCount());
if (getHttpCallCount() > 0) {
  console.log('PASS: HTTP calls were logged through verbose fetch');
} else {
  console.log('FAIL: No HTTP calls were logged!');
}

// Cleanup
globalThis.fetch = originalFetch;
delete (globalThis as any).__agentVerboseFetchInstalled;
