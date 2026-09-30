import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BashTool } from '../src/tool/bash';
import { BatchTool } from '../src/tool/batch';
import { Instance } from '../src/project/instance';
import { Session } from '../src/session';
import { MessageV2 } from '../src/session/message-v2';
import { Tool } from '../src/tool/tool';
import { Identifier } from '../src/id/id';
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';

const directory = await mkdtemp(
  path.join(os.tmpdir(), 'agent-process-status-')
);
afterAll(async () => {
  await Instance.disposeAll();
  await rm(directory, { recursive: true, force: true });
});

const bunCommand = (code: string) => `"${process.execPath}" -e "${code}"`;

async function runBash(
  command: string,
  options: { timeout?: number; abort?: AbortSignal } = {}
) {
  return Instance.provide({
    directory,
    fn: async () => {
      const tool = await BashTool.init();
      return tool.execute(
        {
          command,
          timeout: options.timeout,
          description: 'Test command status',
        },
        {
          sessionID: 'ses_status',
          messageID: 'msg_status',
          agent: 'build',
          abort: options.abort ?? new AbortController().signal,
          metadata() {},
        }
      );
    },
  });
}

describe('process tool status (#317)', () => {
  test.skipIf(process.platform === 'win32')(
    'false fails visibly and true stays empty',
    async () => {
      const failure = await runBash('false');
      expect(failure.output).toBe('Exit code 1\n');
      expect(failure.isError).toBe(true);
      const success = await runBash('true');
      expect(success.output).toBe('');
      expect(success.isError).not.toBe(true);
    }
  );
  test('a quiet failure carries exit status in model-visible text', async () => {
    const result = await runBash(bunCommand('process.exit(1)'));
    expect(result.output).toBe('Exit code 1\n');
    expect(result.isError).toBe(true);
    expect(result.metadata.exit).toBe(1);
  });

  test('authentication-like output is prefixed with exit code 4', async () => {
    const result = await runBash(
      bunCommand("console.log('Please run gh auth login'); process.exit(4)")
    );
    expect(result.output).toBe('Exit code 4\nPlease run gh auth login\n');
    expect(result.isError).toBe(true);
    expect(result.metadata.exit).toBe(4);
  });

  test('successful commands keep their output unchanged', async () => {
    for (const [code, output] of [
      ['process.exit(0)', ''],
      ["console.log('hello')", 'hello\n'],
    ]) {
      const result = await runBash(bunCommand(code));
      expect(result.output).toBe(output);
      expect(result.isError).not.toBe(true);
      expect(result.metadata.exit).toBe(0);
    }
  });

  test('timeout is an error even when a termination handler exits zero', async () => {
    const result = await runBash(
      bunCommand(
        "process.on('SIGTERM', () => process.exit(0)); setTimeout(() => {}, 2000)"
      ),
      { timeout: 500 }
    );
    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/^Exit code .*\n/);
    expect(result.output).toContain('timed out after 500 ms');
  });

  test('an already aborted command is an error', async () => {
    const result = await runBash(bunCommand('setTimeout(() => {}, 2000)'), {
      abort: AbortSignal.abort(),
    });
    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/^Exit code .*\n/);
    expect(result.output).toContain('Command was aborted');
  });

  test.skipIf(process.platform === 'win32')(
    'timeout kills a child that ignores SIGTERM after its shell exits',
    async () => {
      const started = Date.now();
      const result = await runBash(
        bunCommand(
          "process.on('SIGTERM', () => {}); setTimeout(() => {}, 2000)"
        ),
        { timeout: 500 }
      );
      expect(result.isError).toBe(true);
      expect(Date.now() - started).toBeLessThan(1500);
    }
  );

  test('a running command reports cancellation', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 100);
    try {
      const result = await runBash(bunCommand('setTimeout(() => {}, 2000)'), {
        abort: controller.signal,
      });
      expect(result.isError).toBe(true);
      expect(result.output).toMatch(/^Exit code .*\n/);
      expect(result.output).toContain('Command was aborted');
    } finally {
      clearTimeout(timer);
    }
  });

  test('truncating a failed command keeps the exit prefix', async () => {
    const result = await runBash(
      bunCommand("console.log('x'.repeat(30100)); process.exit(4)")
    );
    expect(result.output).toStartWith('Exit code 4\n');
    expect(result.output).toContain('Output was truncated');
    expect(result.isError).toBe(true);
  });

  test.skipIf(process.platform === 'win32')(
    'signal termination is visible',
    async () => {
      const result = await runBash('kill -TERM $$');
      expect(result.metadata.exit).toBeNull();
      expect(result.isError).toBe(true);
      expect(result.output).toContain('SIGTERM');
      expect(result.output).toMatch(/^Exit code .*\n/);
    }
  );

  test('the provider conversion uses an AI SDK error result', () => {
    expect(
      Tool.toModelOutput({ output: { output: 'Exit code 1\n', isError: true } })
    ).toEqual({ type: 'error-text', value: 'Exit code 1\n' });
    expect(Tool.toModelOutput({ output: { output: 'hello\n' } })).toEqual({
      type: 'text',
      value: 'hello\n',
    });
  });

  test('Anthropic receives is_error on a failed tool result', async () => {
    let request: any;
    const provider = createAnthropic({
      apiKey: 'local-test-token',
      fetch: async (_url, options) => {
        request = JSON.parse(options!.body as string);
        return Response.json({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-5',
          content: [{ type: 'text', text: 'done' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      },
    });
    await generateText({
      model: provider('claude-sonnet-4-5'),
      maxOutputTokens: 10,
      messages: [
        { role: 'user', content: 'run the command' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call_status',
              toolName: 'bash',
              input: { command: 'false' },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call_status',
              toolName: 'bash',
              output: Tool.toModelOutput({
                output: { output: 'Exit code 1\n', isError: true },
              }),
            },
          ],
        },
      ],
    });
    expect(request.messages.at(-1).content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'call_status',
      is_error: true,
      content: 'Exit code 1\n',
    });
  });

  test('a partially failed result retains successful attachments', async () => {
    const attachment: MessageV2.FilePart = {
      id: 'prt_attachment',
      sessionID: 'ses_status',
      messageID: 'msg_status',
      type: 'file',
      mime: 'image/png',
      url: 'data:image/png;base64,aGVsbG8=',
    };
    const state = Tool.toState(
      {
        title: 'batch',
        output: 'One command failed',
        metadata: {},
        isError: true,
        attachments: [attachment],
      },
      { input: {}, time: { start: 0, end: 1 } }
    );
    expect(MessageV2.ToolStateError.parse(state).attachments).toEqual([
      attachment,
    ]);
    const messages = await MessageV2.toModelMessage([
      {
        info: { id: 'msg_status', role: 'assistant' } as MessageV2.Assistant,
        parts: [
          {
            id: 'prt_status',
            sessionID: 'ses_status',
            messageID: 'msg_status',
            type: 'tool',
            tool: 'batch',
            callID: 'call_status',
            state,
          },
        ],
      },
    ]);
    expect(
      messages.find((message) => message.role === 'user')?.content
    ).toContainEqual(
      expect.objectContaining({ type: 'file', mediaType: 'image/png' })
    );
  });

  test('batch counts a returned command failure and preserves it in history', async () => {
    await Instance.provide({
      directory,
      fn: async () => {
        const session = await Session.create({});
        const messageID = Identifier.ascending('message');
        try {
          const batch = await BatchTool.init();
          const result = await batch.execute(
            {
              tool_calls: [
                {
                  tool: 'bash',
                  parameters: { command: bunCommand('process.exit(4)') },
                },
              ],
            },
            {
              sessionID: session.id,
              messageID,
              agent: 'build',
              abort: new AbortController().signal,
              metadata() {},
            }
          );
          expect(result.isError).toBe(true);
          expect(result.metadata.failed).toBe(1);
          expect(result.metadata.successful).toBe(0);
          const [part] = await MessageV2.parts(messageID);
          expect(part.type).toBe('tool');
          if (part.type !== 'tool') throw new Error('Expected tool part');
          expect(part.state.status).toBe('error');
          expect(part.state.metadata?.exit).toBe(4);
          const messages = await MessageV2.toModelMessage([
            {
              info: { id: messageID, role: 'assistant' } as MessageV2.Assistant,
              parts: [part],
            },
          ]);
          const toolMessage = messages.find(
            (message) => message.role === 'tool'
          );
          expect(toolMessage?.content[0]).toMatchObject({
            type: 'tool-result',
            output: { type: 'error-text', value: 'Exit code 4\n' },
          });
        } finally {
          await Session.remove(session.id);
        }
      },
    });
  });
});
