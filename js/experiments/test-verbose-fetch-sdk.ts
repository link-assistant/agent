/**
 * Experiment: Test if custom fetch gets called through @ai-sdk/anthropic SDK
 * Related to: https://github.com/link-assistant/agent/issues/215
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';

let fetchCallCount = 0;

const customFetch = async (input: any, init?: any): Promise<Response> => {
  fetchCallCount++;
  const url = typeof input === 'string' ? input : (input?.url ?? String(input));
  console.log(
    `[CUSTOM FETCH #${fetchCallCount}] URL: ${url}, Method: ${init?.method ?? 'GET'}`
  );

  const mockResponse = {
    id: 'msg_test123',
    type: 'message',
    role: 'assistant',
    model: 'test-model',
    content: [{ type: 'text', text: 'Hello test.' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };

  return new Response(JSON.stringify(mockResponse), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const anthropic = createAnthropic({
  apiKey: 'test-key',
  baseURL: 'https://mock.api.test/v1',
  fetch: customFetch,
});

console.log('[TEST] Attempting generateText...');

try {
  const result = await generateText({
    model: anthropic('test-model'),
    prompt: 'Hello',
  });
  console.log('[TEST] Result:', result.text);
} catch (e) {
  console.log('[TEST] Error:', (e as Error).message);
}

console.log(`[TEST] Custom fetch called ${fetchCallCount} time(s)`);
console.log(
  fetchCallCount === 0
    ? '[BUG] Custom fetch was NEVER called!'
    : '[OK] Custom fetch IS working.'
);
