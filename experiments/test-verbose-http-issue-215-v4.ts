/**
 * Experiment v4: Test if custom fetch actually gets called by @ai-sdk/anthropic
 * Related to: https://github.com/link-assistant/agent/issues/215
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';

let fetchCallCount = 0;

// Create a custom fetch that logs and then returns a mock response
const customFetch = async (input: any, init?: any): Promise<Response> => {
  fetchCallCount++;
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  console.log(`[CUSTOM FETCH #${fetchCallCount}] Called!`);
  console.log(`[CUSTOM FETCH #${fetchCallCount}] Method: ${init?.method ?? 'GET'}`);
  console.log(`[CUSTOM FETCH #${fetchCallCount}] URL: ${url}`);

  // Return a mock Anthropic API response
  const mockResponse = {
    id: "msg_test123",
    type: "message",
    role: "assistant",
    model: "test-model",
    content: [
      {
        type: "text",
        text: "Hello! This is a test response."
      }
    ],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    }
  };

  return new Response(JSON.stringify(mockResponse), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

// Create Anthropic provider with custom fetch
const anthropic = createAnthropic({
  apiKey: 'test-key',
  baseURL: 'https://mock.api.test/v1',
  fetch: customFetch,
});

console.log('[TEST] Provider created with custom fetch');
console.log('[TEST] Attempting to call generateText...');

try {
  const result = await generateText({
    model: anthropic('test-model'),
    prompt: 'Hello',
  });
  console.log('[TEST] generateText succeeded, text:', result.text);
} catch (e) {
  console.log('[TEST] generateText failed:', (e as Error).message);
}

console.log(`[TEST] Custom fetch was called ${fetchCallCount} time(s)`);

if (fetchCallCount === 0) {
  console.log('[TEST] *** BUG CONFIRMED: Custom fetch was NEVER called! ***');
} else {
  console.log('[TEST] Custom fetch IS working correctly.');
}
