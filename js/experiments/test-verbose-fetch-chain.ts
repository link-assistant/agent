/**
 * Experiment: Verify that the verbose fetch wrapper in provider.ts
 * actually intercepts HTTP calls made by generateText/streamText.
 *
 * This test creates an OpenAI-compatible provider with a custom fetch
 * and verifies the fetch is actually called.
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';

let fetchCallCount = 0;

const trackingFetch = async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
  fetchCallCount++;
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as any).url;
  console.log(
    `[TRACKING FETCH] Call #${fetchCallCount}: ${init?.method ?? 'GET'} ${url}`
  );

  // Return a mock response that looks like an OpenAI-compatible API response
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: Date.now(),
      model: 'test-model',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Hello from mock!',
          },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }
  );
};

console.log('=== Test: Does createOpenAICompatible pass custom fetch? ===');
console.log('');

const provider = createOpenAICompatible({
  name: 'test-provider',
  baseURL: 'https://api.test.example.com/v1',
  fetch: trackingFetch,
});

const model = provider.languageModel('test-model');

console.log('Calling generateText...');
try {
  const result = await generateText({
    model,
    messages: [{ role: 'user', content: 'Hello' }],
  });
  console.log(`Result: ${result.text}`);
  console.log(`Fetch call count: ${fetchCallCount}`);
  if (fetchCallCount > 0) {
    console.log('✅ SUCCESS: Custom fetch was called by generateText!');
  } else {
    console.log('❌ FAILURE: Custom fetch was NOT called by generateText!');
  }
} catch (err) {
  console.error('Error:', err);
  console.log(`Fetch call count after error: ${fetchCallCount}`);
  if (fetchCallCount > 0) {
    console.log(
      '✅ Custom fetch WAS called (error may be from response parsing)'
    );
  } else {
    console.log('❌ Custom fetch was NOT called at all!');
  }
}
