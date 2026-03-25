/**
 * Experiment: Verify that createAnthropic actually uses the custom fetch option
 * This tests whether @ai-sdk/anthropic passes the custom fetch function through
 * to its HTTP calls, which is the core assumption of the verbose logging wrapper.
 *
 * Issue: https://github.com/link-assistant/agent/issues/215
 */

import { createAnthropic } from '@ai-sdk/anthropic';

// Track whether our custom fetch was called
let fetchCallCount = 0;
let lastFetchUrl: string | undefined;

// Create a custom fetch that logs calls
const trackingFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  fetchCallCount++;
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as any).url;
  lastFetchUrl = url;
  console.log(`[TRACKING FETCH] Call #${fetchCallCount}: ${init?.method ?? 'GET'} ${url}`);

  // Return a mock response that looks like an Anthropic API response
  return new Response(JSON.stringify({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello' }],
    model: 'test-model',
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5 },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

// Create the Anthropic provider with our tracking fetch
const provider = createAnthropic({
  apiKey: 'test-key-12345678',
  fetch: trackingFetch,
});

// Get a language model
const model = provider.languageModel('test-model');

console.log('--- Test: Does createAnthropic pass custom fetch to HTTP calls? ---');
console.log(`Model: ${model.modelId}`);
console.log(`Provider: ${model.provider}`);

try {
  // Try to make a call using the model's doGenerate method
  const result = await model.doGenerate({
    inputFormat: 'messages',
    mode: { type: 'regular' },
    prompt: [
      { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
    ],
  });
  console.log(`\nResult: ${JSON.stringify(result.text)}`);
} catch (e: any) {
  console.log(`\nError (might be expected): ${e.message}`);
}

console.log(`\n--- Results ---`);
console.log(`Custom fetch was called: ${fetchCallCount > 0 ? 'YES' : 'NO'}`);
console.log(`Call count: ${fetchCallCount}`);
console.log(`Last URL: ${lastFetchUrl}`);

if (fetchCallCount === 0) {
  console.log('\n!!! BUG: createAnthropic did NOT use our custom fetch function !!!');
  console.log('This explains why verbose HTTP logging never fires.');
  process.exit(1);
} else {
  console.log('\nCustom fetch works correctly with @ai-sdk/anthropic.');
  process.exit(0);
}
