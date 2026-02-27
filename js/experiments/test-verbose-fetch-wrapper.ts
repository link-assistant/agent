/**
 * Experiment: Test if the verbose HTTP logging wrapper is applied when Flag.OPENCODE_VERBOSE is true.
 *
 * This simulates what happens in getSDK() to verify the fetch wrapping chain works.
 * Run with: cd js && bun run experiments/test-verbose-fetch-wrapper.ts
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

// Simulate the verbose flag states
let verbose = false;

// Track if our custom fetch was called
let customFetchCalled = false;
let customFetchUrl = '';
let verboseWrapperCalled = false;

// Create a mock fetch that records calls
const mockFetch = async (input: any, init?: any) => {
  customFetchCalled = true;
  customFetchUrl =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  console.log(`[MOCK FETCH] Called with URL: ${customFetchUrl}`);

  // Return a mock response
  return new Response(
    JSON.stringify({
      id: 'test',
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
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }
  );
};

// Simulate the SDK creation with and without verbose
async function testSDKCreation(verboseEnabled: boolean) {
  verbose = verboseEnabled;
  customFetchCalled = false;
  customFetchUrl = '';
  verboseWrapperCalled = false;

  const options: any = {
    baseURL: 'https://api.test.com/v1',
    apiKey: 'test-key',
  };

  // Simulate RetryFetch wrapping (simplified)
  options['fetch'] = mockFetch;

  // Simulate verbose wrapping (exactly as in provider.ts)
  if (verbose) {
    const innerFetch = options['fetch'];
    options['fetch'] = async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      verboseWrapperCalled = true;
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      const method = init?.method ?? 'GET';

      console.log(`[VERBOSE WRAPPER] HTTP ${method} ${url}`);

      const response = await innerFetch(input, init);

      console.log(
        `[VERBOSE WRAPPER] HTTP ${response.status} ${response.statusText}`
      );

      return response;
    };
  }

  // Create SDK (same as provider.ts line 1401-1404)
  const sdk = createOpenAICompatible({
    name: 'test-provider',
    ...options,
  });

  // Get a language model
  const model = sdk.languageModel('test-model');

  console.log(`\n=== Test with verbose=${verboseEnabled} ===`);
  console.log(`Model type: ${model.constructor?.name || typeof model}`);
  console.log(`Model ID: ${model.modelId}`);

  return { sdk, model, options };
}

// Run tests
console.log('Testing verbose fetch wrapper application...\n');

// Test 1: Without verbose
const result1 = await testSDKCreation(false);
console.log(`Verbose wrapper applied: false`);

// Test 2: With verbose
const result2 = await testSDKCreation(true);
console.log(`Verbose wrapper applied: true`);

// Now test actual API call simulation
console.log('\n=== Testing actual fetch calls via AI SDK ===\n');

// Import generateText to test the fetch chain
import { generateText } from 'ai';

// Test with verbose=true
const { model: verboseModel } = await testSDKCreation(true);
customFetchCalled = false;
verboseWrapperCalled = false;

console.log('\nCalling generateText with verbose-wrapped model...');
try {
  const result = await generateText({
    model: verboseModel,
    prompt: 'Hello!',
  });
  console.log(`\nResult: ${JSON.stringify(result.text)}`);
  console.log(`Custom fetch was called: ${customFetchCalled}`);
  console.log(`Verbose wrapper was called: ${verboseWrapperCalled}`);
  console.log(`URL: ${customFetchUrl}`);
} catch (e: any) {
  console.log(`Error: ${e.message}`);
  console.log(`Custom fetch was called: ${customFetchCalled}`);
  console.log(`Verbose wrapper was called: ${verboseWrapperCalled}`);
  console.log(`URL: ${customFetchUrl}`);
}

console.log('\n=== CONCLUSION ===');
if (verboseWrapperCalled) {
  console.log('SUCCESS: The verbose fetch wrapper IS called by the AI SDK.');
  console.log(
    'The bug must be elsewhere (e.g., logging configuration, flag timing).'
  );
} else if (customFetchCalled) {
  console.log('PARTIAL: Custom fetch was called but NOT the verbose wrapper.');
  console.log(
    'This means the SDK uses its own fetch path that bypasses our wrapper.'
  );
} else {
  console.log('FAILURE: Neither custom fetch nor verbose wrapper was called.');
  console.log('The SDK completely ignores the fetch option!');
}
