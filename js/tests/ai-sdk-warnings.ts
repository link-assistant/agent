import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, Output, streamText } from 'ai';
import { z } from 'zod';

function successfulChatCompletion() {
  const chunks = [
    {
      id: 'chatcmpl-test',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'test-model',
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: 'ok' },
          finish_reason: null,
        },
      ],
    },
    {
      id: 'chatcmpl-test',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'test-model',
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: 'stop',
        },
      ],
    },
  ];
  const body =
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') +
    'data: [DONE]\n\n';

  return new Response(body, {
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('AI SDK warning-free multi-turn requests', () => {
  test('OpenAI-compatible requests do not emit warnings', async () => {
    const provider = createOpenAICompatible({
      name: 'test-provider',
      baseURL: 'https://example.invalid/v1',
      apiKey: 'test-key',
      fetch: async () => successfulChatCompletion(),
    });
    const model = provider('test-model');

    const warnings = await captureWarnings(async () => {
      for (let turn = 0; turn < 2; turn++) {
        const result = streamText({
          model,
          instructions: 'You are a test assistant.',
          messages: [{ role: 'user', content: `Turn ${turn + 1}` }],
        });
        expect(await result.text).toBe('ok');
      }
    });

    expect(warnings).toBe('');
  });
});

function jsonChatCompletion(content: string) {
  const body = JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 0,
    model: 'test-model',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });

  return new Response(body, {
    headers: { 'content-type': 'application/json' },
  });
}

function testModel(content = 'ok', supportsStructuredOutputs = false) {
  return createOpenAICompatible({
    name: 'test-provider',
    baseURL: 'https://example.invalid/v1',
    apiKey: 'test-key',
    supportsStructuredOutputs,
    fetch: async () => jsonChatCompletion(content),
  })('test-model');
}

// AI SDK 7 reports warnings through process.emitWarning, not console.warn, so
// a console.warn mock never sees them and every "warning-free" assertion
// passed regardless (#337). The AI_SDK_LOG_WARNINGS hook receives each
// warning, including deprecations the default logger reports only once.
async function captureWarnings(run: () => Promise<unknown>) {
  const warnings: string[] = [];
  const scope = globalThis as { AI_SDK_LOG_WARNINGS?: unknown };
  const previous = scope.AI_SDK_LOG_WARNINGS;
  scope.AI_SDK_LOG_WARNINGS = (options: { warnings: unknown[] }) => {
    for (const warning of options.warnings) {
      warnings.push(JSON.stringify(warning));
    }
  };
  try {
    await run();
  } finally {
    scope.AI_SDK_LOG_WARNINGS = previous;
  }
  return warnings.join('\n');
}

describe('captureWarnings', () => {
  test('sees the warnings the AI SDK emits', async () => {
    const warnings = await captureWarnings(() =>
      generateText({
        model: testModel('{"answer":"ok"}'),
        output: Output.object({ schema: z.object({ answer: z.string() }) }),
        prompt: 'Answer this.',
      })
    );

    expect(warnings).toContain('responseFormat');
  });
});

// Regression guard for issue #301: every CI run of the summary and agent code
// paths printed warnings about system messages in the messages field.
// AI SDK 7 rejects that shape and accepts top-level instructions.
describe('system prompts are passed through the instructions option', () => {
  test('system messages inside messages are rejected', async () => {
    await expect(
      generateText({
        model: testModel(),
        messages: [
          { role: 'system', content: 'You are a test assistant.' },
          { role: 'user', content: 'Summarize this.' },
        ],
      })
    ).rejects.toThrow('System messages are not allowed');
  });

  test('generateText with instructions is warning-free', async () => {
    const warnings = await captureWarnings(() =>
      generateText({
        model: testModel(),
        instructions: [
          { role: 'system' as const, content: 'You are a test assistant.' },
        ],
        messages: [{ role: 'user' as const, content: 'Summarize this.' }],
      })
    );

    expect(warnings).toBe('');
  });

  // The structured output shape Agent.generate uses. generateObject, which it
  // used before, is deprecated in AI SDK 7 (#337).
  test('structured output with instructions is warning-free', async () => {
    let output: unknown;
    const warnings = await captureWarnings(async () => {
      const result = await generateText({
        model: testModel('{"answer":"ok"}', true),
        output: Output.object({ schema: z.object({ answer: z.string() }) }),
        instructions: [
          { role: 'system' as const, content: 'You are a test assistant.' },
        ],
        prompt: [{ role: 'user' as const, content: 'Answer this.' }],
      });
      output = result.output;
    });

    expect(warnings).toBe('');
    expect(output).toEqual({ answer: 'ok' });
  });
});

describe('deprecated AI SDK APIs', () => {
  test('src does not import generateObject or streamObject', () => {
    const src = join(import.meta.dir, '..', 'src');
    const offenders = readdirSync(src, { recursive: true, encoding: 'utf8' })
      .filter((file) => /\.(ts|tsx|js)$/.test(file))
      .filter((file) =>
        /import\s*{[^}]*\b(generateObject|streamObject)\b[^}]*}\s*from\s*['"]ai['"]/.test(
          readFileSync(join(src, file), 'utf8')
        )
      );

    expect(offenders).toEqual([]);
  });
});
