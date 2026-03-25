/**
 * Experiment: Verify that createAnthropic actually uses the custom fetch option
 * Issue: https://github.com/link-assistant/agent/issues/215
 */

import { createAnthropic } from '@ai-sdk/anthropic';

let fetchCallCount = 0;
let lastFetchUrl: string | undefined;

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
  lastFetchUrl = url;
  console.log(
    `[TRACKING FETCH] Call #${fetchCallCount}: ${init?.method ?? 'GET'} ${url}`
  );

  return new Response(
    JSON.stringify({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello' }],
      model: 'test-model',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }
  );
};

const provider = createAnthropic({
  apiKey: 'test-key-12345678',
  fetch: trackingFetch,
});

const model = provider.languageModel('test-model');

console.log(
  '--- Test: Does createAnthropic pass custom fetch to HTTP calls? ---'
);

try {
  await model.doGenerate({
    inputFormat: 'messages',
    mode: { type: 'regular' },
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
  });
} catch (e: any) {
  console.log(`Error (might be expected): ${e.message}`);
}

console.log(
  `\nCustom fetch called: ${fetchCallCount > 0 ? 'YES' : 'NO'} (count: ${fetchCallCount})`
);
console.log(`Last URL: ${lastFetchUrl}`);

if (fetchCallCount === 0) {
  console.log('\n!!! BUG: createAnthropic did NOT use custom fetch !!!');
  process.exit(1);
} else {
  console.log('\nCustom fetch works correctly.');
  process.exit(0);
}
