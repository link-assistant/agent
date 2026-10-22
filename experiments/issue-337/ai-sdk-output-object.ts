// Issue #337: does generateText + Output.object replace the deprecated
// generateObject without any AI SDK warning? Run from js/:
//   bun ../experiments/issue-337/ai-sdk-output-object.ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateObject, generateText, Output } from 'ai';
import { z } from 'zod';

const reply = (content: string) =>
  new Response(
    JSON.stringify({
      id: 'x', object: 'chat.completion', created: 0, model: 'm',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { headers: { 'content-type': 'application/json' } }
  );
const model = (supportsStructuredOutputs: boolean) =>
  createOpenAICompatible({
    name: 'p', baseURL: 'https://example.invalid/v1', apiKey: 'k',
    supportsStructuredOutputs, fetch: async () => reply('{"answer":"ok"}'),
  })('m');
const schema = z.object({ answer: z.string() });

for (const structured of [false, true]) {
  console.log(`--- generateObject, structuredOutputs=${structured}`);
  console.log((await generateObject({ model: model(structured), schema, prompt: 'q' })).object);
  console.log(`--- generateText+Output.object, structuredOutputs=${structured}`);
  console.log((await generateText({ model: model(structured), output: Output.object({ schema }), prompt: 'q' })).output);
}
