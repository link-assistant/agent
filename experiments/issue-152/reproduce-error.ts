/**
 * Reproduction script for Issue #152
 *
 * Error: Cannot read properties of undefined (reading 'input_tokens')
 *
 * This script demonstrates the error that occurs when using the Vercel AI SDK
 * with providers that don't return proper usage data in their API responses.
 *
 * Prerequisites:
 * - bun installed
 * - MOONSHOT_API_KEY environment variable set (or another provider)
 *
 * Run with:
 *   bun run experiments/issue-152/reproduce-error.ts
 *
 * @see https://github.com/link-assistant/agent/issues/152
 */

import { streamText } from 'ai';

// Simulated provider response that causes the error
// When a provider returns an empty or undefined usage object,
// the AI SDK crashes when trying to access usage.input_tokens

interface MockUsageResponse {
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

/**
 * Demonstrates the root cause of the error.
 * The Vercel AI SDK expects usage.inputTokens to always be defined,
 * but some providers return undefined or null.
 */
function demonstrateError() {
  console.log('=== Demonstrating the error ===\n');

  // Case 1: Completely missing usage object
  const response1: MockUsageResponse = {};
  try {
    // This is what the AI SDK does internally
    const inputTokens = response1.usage!.inputTokens;
    console.log('Case 1 - Input tokens:', inputTokens);
  } catch (error) {
    console.log('Case 1 - ERROR:', (error as Error).message);
    console.log('  This is the error we see: Cannot read properties of undefined\n');
  }

  // Case 2: Usage object exists but inputTokens is undefined
  const response2: MockUsageResponse = { usage: {} };
  try {
    const inputTokens = response2.usage!.inputTokens;
    console.log('Case 2 - Input tokens:', inputTokens); // This works but returns undefined
    console.log('  No error, but value is undefined\n');
  } catch (error) {
    console.log('Case 2 - ERROR:', (error as Error).message);
  }

  // Case 3: Proper response with usage data
  const response3: MockUsageResponse = {
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    },
  };
  try {
    const inputTokens = response3.usage!.inputTokens;
    console.log('Case 3 - Input tokens:', inputTokens);
    console.log('  This is the expected response\n');
  } catch (error) {
    console.log('Case 3 - ERROR:', (error as Error).message);
  }
}

/**
 * Safe usage extraction that handles all edge cases.
 * This is how the code should handle usage data.
 */
function safeGetUsage(response: MockUsageResponse): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
} {
  const usage = response.usage;

  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
  };
}

/**
 * Demonstrates the fix - using safe property access.
 */
function demonstrateFix() {
  console.log('=== Demonstrating the fix ===\n');

  const responses: MockUsageResponse[] = [
    {}, // Missing usage
    { usage: {} }, // Empty usage
    { usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } }, // Complete
  ];

  responses.forEach((response, index) => {
    const usage = safeGetUsage(response);
    console.log(`Response ${index + 1}:`, usage);
  });
}

/**
 * Example of how to properly wrap AI SDK calls to handle this error.
 */
async function wrappedStreamExample() {
  console.log('\n=== Wrapped Stream Example ===\n');

  // This is a conceptual example - you'd need actual provider configuration
  console.log('In production, wrap your streamText calls like this:');
  console.log(`
try {
  const result = await streamText({
    model: provider('model-name'),
    prompt: 'Hello',
    maxRetries: 0, // Disable AI SDK's retry to handle it ourselves
  });

  for await (const event of result.fullStream) {
    if (event.type === 'finish-step') {
      // Safe access pattern
      const usage = event.usage ?? {};
      const inputTokens = usage.inputTokens ?? 0;
      const outputTokens = usage.outputTokens ?? 0;

      console.log('Usage:', { inputTokens, outputTokens });
    }
  }
} catch (error) {
  if (error instanceof TypeError && error.message.includes('input_tokens')) {
    console.warn('Provider returned invalid usage data');
    // Handle gracefully
  }
  throw error;
}
`);
}

/**
 * Moonshot Kimi API response format example.
 * Shows the difference between OpenAI format (prompt_tokens)
 * and Vercel AI SDK format (inputTokens).
 */
function showMoonshotResponseFormat() {
  console.log('\n=== Moonshot API Response Format ===\n');

  const moonshotResponse = {
    usage: {
      prompt_tokens: 12345,        // Moonshot uses this
      completion_tokens: 678,       // Moonshot uses this
      total_tokens: 13023,
      prompt_tokens_details: null,
      completion_tokens_details: null,
    },
  };

  console.log('Moonshot API returns:');
  console.log(JSON.stringify(moonshotResponse, null, 2));

  const vercelExpected = {
    usage: {
      inputTokens: 12345,          // AI SDK expects this
      outputTokens: 678,            // AI SDK expects this
      totalTokens: 13023,
    },
  };

  console.log('\nVercel AI SDK expects:');
  console.log(JSON.stringify(vercelExpected, null, 2));

  console.log('\nThe provider must transform prompt_tokens -> inputTokens');
  console.log('If this transformation fails or response is malformed,');
  console.log('the SDK crashes with "Cannot read properties of undefined"');
}

// Run all demonstrations
console.log('Issue #152: Cannot read properties of undefined (reading \'input_tokens\')');
console.log('='.repeat(70) + '\n');

demonstrateError();
demonstrateFix();
wrappedStreamExample();
showMoonshotResponseFormat();

console.log('\n' + '='.repeat(70));
console.log('For full analysis, see: docs/case-studies/issue-152/CASE-STUDY.md');
