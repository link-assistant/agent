import { expect, test } from 'bun:test';
import { generateText, streamText } from 'ai';
import { createEchoModel } from '../src/provider/echo';
import { createCacheModel } from '../src/provider/cache';

test('the local echo model works with AI SDK generation and streaming', async () => {
  const model = createEchoModel();
  expect(model.specificationVersion).toBe('v4');
  const generated = await generateText({
    model,
    prompt: 'hello',
  });
  expect(generated.text).toBe('hello');

  const streamed = streamText({
    model,
    prompt: 'world',
  });
  expect(await streamed.text).toBe('world');
});

test('the local cache model works with AI SDK 7 generation and streaming', async () => {
  const model = createCacheModel('test', 'ai-sdk-7');
  expect(model.specificationVersion).toBe('v4');

  const generated = await generateText({ model, prompt: 'cached hello' });
  expect(generated.text).toBe('cached hello');

  const streamed = streamText({ model, prompt: 'cached hello' });
  expect(await streamed.text).toBe('cached hello');
});
