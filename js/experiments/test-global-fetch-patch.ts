/**
 * Experiment: Verify that the global fetch monkey-patch captures
 * HTTP calls made by AI SDK providers (createOpenAICompatible).
 *
 * This simulates what happens in production:
 * 1. Global fetch is patched with verbose logging
 * 2. AI SDK provider is created (without custom fetch option)
 * 3. generateText is called
 * 4. The global patch should catch the HTTP call
 */

import { config, setVerbose } from '../src/config/agent-config';
import { Log } from '../src/util/log';
import { createVerboseFetch } from '../src/util/verbose-fetch';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';

// Step 1: Enable verbose mode and init logging
setVerbose(true);
await Log.init({
  print: true,
  level: 'DEBUG',
});

// Step 2: Install global fetch monkey-patch
const originalFetch = globalThis.fetch;
let patchedCallCount = 0;

// Wrap with verbose fetch, then also wrap with mock to prevent real HTTP calls
const verboseFetch = createVerboseFetch(originalFetch, { caller: 'global' });

// Mock the actual network call (we don't want to hit a real API)
globalThis.fetch = async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
  patchedCallCount++;
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as any).url;

  console.log(
    `\n>>> GLOBAL FETCH INTERCEPTED: ${init?.method ?? 'GET'} ${url}`
  );
  console.log(`>>> Call count: ${patchedCallCount}`);

  // Return mock response
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: Date.now(),
      model: 'test-model',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hello from mock!' },
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

// Now install the verbose wrapper on top
globalThis.fetch = createVerboseFetch(globalThis.fetch, { caller: 'global' });
(globalThis as any).__agentVerboseFetchInstalled = true;

console.log('=== Global fetch monkey-patch installed ===');
console.log('');

// Step 3: Create AI SDK provider WITHOUT custom fetch
// This simulates what happens when the SDK doesn't pass fetch correctly
const provider = createOpenAICompatible({
  name: 'test-provider',
  baseURL: 'https://api.test.example.com/v1',
  // NOTE: No fetch option provided! The SDK uses globalThis.fetch
});

const model = provider.languageModel('test-model');

// Step 4: Call generateText
console.log('Calling generateText (should trigger global fetch patch)...');
console.log('');

try {
  const result = await generateText({
    model,
    messages: [{ role: 'user', content: 'Hello' }],
  });
  console.log(`\n>>> Result: ${result.text}`);
  console.log(`>>> Patched fetch call count: ${patchedCallCount}`);
  if (patchedCallCount > 0) {
    console.log(
      '✅ SUCCESS: Global fetch monkey-patch intercepted AI SDK calls!'
    );
  } else {
    console.log(
      '❌ FAILURE: Global fetch monkey-patch did NOT intercept calls!'
    );
  }
} catch (err) {
  console.error('Error:', err);
  if (patchedCallCount > 0) {
    console.log(
      '✅ Global fetch WAS intercepted (error may be from response parsing)'
    );
  } else {
    console.log('❌ Global fetch was NOT intercepted!');
  }
}

// Restore original fetch
globalThis.fetch = originalFetch;
