/**
 * Experiment: Verify that @ai-sdk/anthropic actually uses the passed fetch option
 */

import { createAnthropic } from '@ai-sdk/anthropic';

let customFetchCalled = false;
let customFetchUrl = '';

const customFetch = async (input: any, init?: any) => {
  customFetchCalled = true;
  const url = typeof input === 'string' ? input : input?.url;
  customFetchUrl = url;
  console.log('[CUSTOM FETCH] URL:', url, 'Method:', init?.method ?? 'GET');
  return new Response(
    JSON.stringify({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'test' }],
      model: 'test',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
};

const anthropic = createAnthropic({
  name: 'opencode',
  apiKey: 'test-key',
  fetch: customFetch,
});

const model = anthropic('minimax-m2.5-free');
console.log('Model created:', model.modelId);

try {
  await model.doGenerate({
    inputFormat: 'prompt',
    mode: { type: 'regular' },
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  });
} catch (e: any) {
  console.log('Error:', e.message?.slice(0, 200));
}

console.log('customFetchCalled:', customFetchCalled);
if (customFetchCalled) {
  console.log('PASS: SDK correctly uses the passed fetch option');
} else {
  console.log('FAIL: SDK does NOT use the passed fetch option');
}
