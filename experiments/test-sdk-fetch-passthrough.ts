/**
 * Experiment: Verify that @ai-sdk/anthropic actually uses the passed fetch option
 *
 * Creates an Anthropic SDK instance with a custom fetch that logs when called,
 * then checks if the SDK uses that custom fetch for API calls.
 */

import { createAnthropic } from '@ai-sdk/anthropic';

let customFetchCalled = false;
let customFetchUrl = '';

const customFetch = async (input: any, init?: any) => {
  customFetchCalled = true;
  const url = typeof input === 'string' ? input : input?.url || input?.toString();
  customFetchUrl = url;
  console.log('[CUSTOM FETCH] Called with URL:', url);
  console.log('[CUSTOM FETCH] Method:', init?.method ?? 'GET');

  // Return a fake response to avoid actual API calls
  return new Response(JSON.stringify({
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "test" }],
    model: "test",
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 5 }
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

// Create Anthropic SDK with custom fetch
const anthropic = createAnthropic({
  name: 'opencode',
  apiKey: 'test-key',
  fetch: customFetch,
});

// Try to create a model and make a call
const model = anthropic('minimax-m2.5-free');
console.log('Model created:', model.modelId);

try {
  // Call doGenerate to trigger an API call
  const result = await model.doGenerate({
    inputFormat: 'prompt',
    mode: { type: 'regular' },
    prompt: [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] }
    ],
  });
  console.log('\nGenerate result received');
} catch (e: any) {
  console.log('\nError (may be expected):', e.message?.slice(0, 200));
}

console.log('\n=== RESULT ===');
console.log('customFetchCalled:', customFetchCalled);
console.log('customFetchUrl:', customFetchUrl);

if (customFetchCalled) {
  console.log('PASS: SDK correctly uses the passed fetch option');
} else {
  console.log('FAIL: SDK does NOT use the passed fetch option - this explains the bug!');
}
