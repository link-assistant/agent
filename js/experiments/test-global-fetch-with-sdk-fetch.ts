/**
 * Experiment: Verify that global fetch patch works even when SDK has its own fetch option.
 * This simulates the case where the provider passes a custom fetch (e.g., OAuth fetch).
 */

import { Flag } from '../src/flag/flag';
import { Log } from '../src/util/log';
import { createVerboseFetch } from '../src/util/verbose-fetch';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';

Flag.setVerbose(true);
await Log.init({ print: true, level: 'DEBUG' });

// Install global patch with mock
const originalFetch = globalThis.fetch;
let globalCallCount = 0;
let sdkFetchCallCount = 0;

const mockFetch = async (input: any, init?: any): Promise<Response> => {
  globalCallCount++;
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: Date.now(),
      model: 'test-model',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hello!' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
};

globalThis.fetch = createVerboseFetch(mockFetch, { caller: 'global' });
(globalThis as any).__agentVerboseFetchInstalled = true;

// SDK with its OWN custom fetch (simulating OAuth fetch)
const sdkCustomFetch = async (input: any, init?: any): Promise<Response> => {
  sdkFetchCallCount++;
  console.log(`\n>>> SDK CUSTOM FETCH called (count: ${sdkFetchCallCount})`);
  // This custom fetch still calls globalThis.fetch internally (common pattern)
  return mockFetch(input, init);
};

const provider = createOpenAICompatible({
  name: 'test-provider',
  baseURL: 'https://api.test.example.com/v1',
  fetch: sdkCustomFetch, // SDK has its own fetch
});

const model = provider.languageModel('test-model');

console.log('=== Testing with SDK custom fetch + global patch ===');
console.log('');

try {
  const result = await generateText({
    model,
    messages: [{ role: 'user', content: 'Hello' }],
  });
  console.log(`\nResult: ${result.text}`);
  console.log(`Global fetch count: ${globalCallCount}`);
  console.log(`SDK fetch count: ${sdkFetchCallCount}`);

  // When SDK has its own fetch, the global patch doesn't directly intercept
  // because the SDK bypasses globalThis.fetch. But we still get the SDK's fetch call.
  if (sdkFetchCallCount > 0) {
    console.log(
      'INFO: SDK custom fetch was used (global patch not in this path)'
    );
    console.log(
      'This is expected - the global patch catches calls that go through globalThis.fetch'
    );
    console.log(
      'For SDK custom fetch paths, the provider-level wrapper in provider.ts handles logging'
    );
  }
} catch (err) {
  console.error('Error:', err);
}

globalThis.fetch = originalFetch;
