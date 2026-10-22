import { describe, expect, test } from 'bun:test';
import type { ModelMessage } from 'ai';
import { ProviderTransform } from '../src/provider/transform';
import { MessageV2 } from '../src/session/message-v2';

/**
 * Replay transforms ported from upstream OpenCode (#335): requests that a
 * strict provider rejects with HTTP 400 on every later turn.
 */

const REPLACEMENT = '�';

function assistantInfo(
  id: string,
  providerID = 'anthropic',
  modelID = 'claude-sonnet-4'
): MessageV2.Assistant {
  return {
    id,
    sessionID: 'ses_test',
    role: 'assistant',
    time: { created: 1 },
    parentID: 'msg_user',
    modelID,
    providerID,
    mode: 'build',
    path: { cwd: '/', root: '/' },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  };
}

function userInfo(id: string): MessageV2.User {
  return {
    id,
    sessionID: 'ses_test',
    role: 'user',
    time: { created: 1 },
    agent: 'build',
    model: { providerID: 'anthropic', modelID: 'claude-sonnet-4' },
  };
}

function base(messageID: string, id: string) {
  return { id, sessionID: 'ses_test', messageID };
}

describe('ProviderTransform.message surrogate sanitizing (upstream #25934)', () => {
  test('lone surrogates in tool results, text and system become U+FFFD', () => {
    const msgs: ModelMessage[] = [
      { role: 'system', content: 'sys\uD83D' },
      { role: 'user', content: [{ type: 'text', text: '\uDE00user' }] },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'think\uD83D' },
          { type: 'text', text: 'answer\uD83D' },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'a',
            toolName: 'bash',
            output: { type: 'text', value: 'ok\uD83D' },
          },
          {
            type: 'tool-result',
            toolCallId: 'b',
            toolName: 'bash',
            output: {
              type: 'content',
              value: [{ type: 'text', text: 'cut\uD83D' }],
            },
          },
        ],
      },
    ];
    const out = ProviderTransform.message(
      msgs,
      'anthropic',
      'claude-sonnet-4',
      '@ai-sdk/anthropic'
    ) as any[];
    expect(out[0].content).toBe('sys' + REPLACEMENT);
    expect(out[1].content[0].text).toBe(REPLACEMENT + 'user');
    expect(out[2].content[0].text).toBe('think' + REPLACEMENT);
    expect(out[2].content[1].text).toBe('answer' + REPLACEMENT);
    expect(out[3].content[0].output.value).toBe('ok' + REPLACEMENT);
    expect(out[3].content[1].output.value[0].text).toBe('cut' + REPLACEMENT);
  });

  test('valid surrogate pairs are kept', () => {
    const out = ProviderTransform.message(
      [{ role: 'user', content: 'smile 😀' }],
      'openai',
      'gpt-5'
    ) as any[];
    expect(out[0].content).toBe('smile 😀');
  });
});

describe('ProviderTransform.message empty parts (upstream #14586, #26276)', () => {
  test('Anthropic: empty text and blank unsigned reasoning are dropped', () => {
    const out = ProviderTransform.message(
      [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: '  ' },
            { type: 'text', text: '' },
            { type: 'tool-call', toolCallId: 'a', toolName: 'x', input: {} },
          ],
        },
      ],
      'anthropic',
      'claude-sonnet-4',
      '@ai-sdk/anthropic'
    ) as any[];
    expect(out[1].content).toHaveLength(1);
    expect(out[1].content[0].type).toBe('tool-call');
  });

  test('Anthropic: signed or redacted reasoning with empty text is kept', () => {
    const out = ProviderTransform.message(
      [
        {
          role: 'assistant',
          content: [
            {
              type: 'reasoning',
              text: '',
              providerOptions: { anthropic: { signature: 's' } },
            },
            {
              type: 'reasoning',
              text: '',
              providerOptions: { anthropic: { redactedData: 'r' } },
            },
          ],
        },
      ],
      'anthropic',
      'claude-sonnet-4',
      '@ai-sdk/anthropic'
    ) as any[];
    expect(out).toHaveLength(1);
    expect(out[0].content).toHaveLength(2);
  });

  test('Anthropic: messages left empty are removed', () => {
    const out = ProviderTransform.message(
      [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: [{ type: 'text', text: '' }] },
        { role: 'assistant', content: '' },
        { role: 'user', content: 'again' },
      ],
      'anthropic',
      'claude-sonnet-4',
      '@ai-sdk/anthropic'
    ) as any[];
    expect(out.map((m) => m.role)).toEqual(['user', 'user']);
  });

  test('Bedrock: uses the bedrock signature namespace', () => {
    const out = ProviderTransform.message(
      [
        {
          role: 'assistant',
          content: [
            {
              type: 'reasoning',
              text: '',
              providerOptions: { bedrock: { signature: 's' } },
            },
            { type: 'text', text: '' },
          ],
        },
      ],
      'amazon-bedrock',
      'anthropic.claude-sonnet-4',
      '@ai-sdk/amazon-bedrock'
    ) as any[];
    expect(out[0].content).toHaveLength(1);
    expect(out[0].content[0].type).toBe('reasoning');
  });

  test('other providers keep empty parts untouched', () => {
    const out = ProviderTransform.message(
      [{ role: 'assistant', content: [{ type: 'text', text: '' }] }],
      'openai',
      'gpt-5',
      '@ai-sdk/openai'
    ) as any[];
    expect(out[0].content).toHaveLength(1);
  });
});

describe('ProviderTransform.message caching options', () => {
  test('cache options are deep-merged and keep the reasoning signature (upstream #10323)', () => {
    const out = ProviderTransform.message(
      [
        { role: 'user', content: 'x' },
        {
          role: 'assistant',
          content: [
            {
              type: 'reasoning',
              text: 't',
              providerOptions: { anthropic: { signature: 's' } },
            },
          ],
        },
      ],
      'openrouter',
      'anthropic/claude-sonnet-4'
    ) as any[];
    const options = out[1].content[0].providerOptions;
    expect(options.anthropic.signature).toBe('s');
    expect(options.anthropic.cacheControl).toEqual({ type: 'ephemeral' });
  });

  test('Bedrock gets cachePoint type default at message level (upstream #11664, #18959)', () => {
    const out = ProviderTransform.message(
      [
        { role: 'user', content: [{ type: 'text', text: 'x' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'y' }] },
      ],
      'amazon-bedrock',
      'anthropic.claude-sonnet-4',
      '@ai-sdk/amazon-bedrock'
    ) as any[];
    for (const msg of out) {
      expect(msg.providerOptions?.bedrock?.cachePoint).toEqual({
        type: 'default',
      });
      expect(msg.content[0].providerOptions).toBeUndefined();
    }
  });
});

describe('ProviderTransform.schema Moonshot/Kimi (upstream #24730)', () => {
  const input = () =>
    ({
      type: 'object',
      properties: {
        a: { $ref: '#/$defs/A', description: 'd' },
        b: { type: 'array', items: [{ type: 'string' }, { type: 'number' }] },
      },
      $defs: { A: { type: 'string' } },
    }) as any;

  test('$ref siblings are dropped and tuple items collapse', () => {
    for (const [providerID, modelID] of [
      ['moonshotai', 'kimi-k2.5'],
      ['opencode', 'kimi-k2.5-free'],
    ]) {
      const out = ProviderTransform.schema(providerID, modelID, input()) as any;
      expect(out.properties.a).toEqual({ $ref: '#/$defs/A' });
      expect(out.properties.b.items).toEqual({ type: 'string' });
      expect(out.$defs).toEqual({ A: { type: 'string' } });
    }
  });

  test('other models are untouched', () => {
    const out = ProviderTransform.schema('openai', 'gpt-5', input()) as any;
    expect(out.properties.a.description).toBe('d');
    expect(Array.isArray(out.properties.b.items)).toBe(true);
  });
});

describe('MessageV2.toModelMessage replay', () => {
  function history(): MessageV2.WithParts[] {
    return [
      {
        info: userInfo('msg_user'),
        parts: [{ ...base('msg_user', 'prt_u1'), type: 'text', text: 'hi' }],
      },
      {
        info: assistantInfo('msg_asst'),
        parts: [
          {
            ...base('msg_asst', 'prt_r1'),
            type: 'reasoning',
            text: 'think',
            metadata: { anthropic: { signature: 'sig' } },
            time: { start: 1, end: 2 },
          },
          {
            ...base('msg_asst', 'prt_r2'),
            type: 'reasoning',
            text: '   ',
            metadata: { anthropic: { signature: 'sig2' } },
            time: { start: 1, end: 2 },
          },
          {
            ...base('msg_asst', 'prt_t1'),
            type: 'text',
            text: 'answer',
            metadata: { anthropic: { foo: 'bar' } },
          },
          {
            ...base('msg_asst', 'prt_tool'),
            type: 'tool',
            callID: 'call_1',
            tool: 'bash',
            metadata: { openai: { itemId: 'fc_1' } },
            state: {
              status: 'completed',
              input: {},
              output: 'done',
              title: '',
              metadata: {},
              time: { start: 1, end: 2 },
            },
          },
        ],
      },
    ] as MessageV2.WithParts[];
  }

  test('another target model gets no provider metadata and reasoning as text (upstream 021e42c0bb1)', async () => {
    const out = (await MessageV2.toModelMessage(history(), {
      providerID: 'openai',
      modelID: 'gpt-5',
    })) as any[];
    const json = JSON.stringify(out);
    expect(json).not.toContain('sig');
    expect(json).not.toContain('fc_1');
    expect(json).not.toContain('"foo"');
    const assistant = out.find((m) => m.role === 'assistant');
    expect(
      assistant.content.some((p: any) => p.type === 'reasoning')
    ).toBeFalse();
    expect(
      assistant.content.find(
        (p: any) => p.type === 'text' && p.text === 'think'
      )
    ).toBeDefined();
    // whitespace-only reasoning is skipped instead of becoming text
    expect(
      assistant.content.filter((p: any) => p.type === 'text')
    ).toHaveLength(2);
  });

  test('the same target model keeps reasoning and metadata', async () => {
    const out = (await MessageV2.toModelMessage(history(), {
      providerID: 'anthropic',
      modelID: 'claude-sonnet-4',
    })) as any[];
    const assistant = out.find((m) => m.role === 'assistant');
    const reasoning = assistant.content.find(
      (p: any) => p.type === 'reasoning'
    );
    expect(reasoning.providerOptions.anthropic.signature).toBe('sig');
  });

  test('without a target the history is replayed unchanged', async () => {
    const out = (await MessageV2.toModelMessage(history())) as any[];
    expect(JSON.stringify(out)).toContain('sig');
  });

  test('signed reasoning keeps an empty text separator as " " (upstream #21370)', async () => {
    const input = [
      {
        info: userInfo('msg_user'),
        parts: [{ ...base('msg_user', 'prt_u1'), type: 'text', text: 'hi' }],
      },
      {
        info: assistantInfo('msg_asst'),
        parts: [
          {
            ...base('msg_asst', 'prt_r1'),
            type: 'reasoning',
            text: 'think',
            metadata: { anthropic: { signature: 's' } },
            time: { start: 1, end: 2 },
          },
          { ...base('msg_asst', 'prt_t1'), type: 'text', text: '' },
          {
            ...base('msg_asst', 'prt_r2'),
            type: 'reasoning',
            text: 'more',
            metadata: { anthropic: { signature: 's2' } },
            time: { start: 1, end: 2 },
          },
        ],
      },
    ] as MessageV2.WithParts[];
    const model = await MessageV2.toModelMessage(input, {
      providerID: 'anthropic',
      modelID: 'claude-sonnet-4',
    });
    const out = ProviderTransform.message(
      model,
      'anthropic',
      'claude-sonnet-4',
      '@ai-sdk/anthropic'
    ) as any[];
    const assistant = out.find((m) => m.role === 'assistant');
    expect(assistant.content.map((p: any) => p.type)).toEqual([
      'reasoning',
      'text',
      'reasoning',
    ]);
    expect(assistant.content[1].text).toBe(' ');
  });

  test('a user message whose parts all convert to nothing is dropped (upstream #4811)', async () => {
    const input = [
      {
        info: userInfo('msg_user'),
        parts: [{ ...base('msg_user', 'prt_u1'), type: 'text', text: 'hi' }],
      },
      {
        info: userInfo('msg_user2'),
        parts: [
          {
            ...base('msg_user2', 'prt_f1'),
            type: 'file',
            mime: 'text/plain',
            url: 'file:///a.txt',
            filename: 'a.txt',
          },
        ],
      },
    ] as MessageV2.WithParts[];
    const out = (await MessageV2.toModelMessage(input)) as any[];
    expect(out).toHaveLength(1);
    for (const msg of out) {
      expect(Array.isArray(msg.content) && msg.content.length === 0).toBe(
        false
      );
    }
  });
});
