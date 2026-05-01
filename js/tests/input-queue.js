import { describe, expect, test } from 'bun:test';
import { InputQueue, parseStreamJsonInput } from '../src/cli/input-queue.js';

describe('InputQueue stream-json input', () => {
  test('queues each Claude stream-json frame as a separate user message', () => {
    const messages = [];
    const queue = new InputQueue({
      inputFormat: 'stream-json',
      autoMerge: true,
      onMessage: (message) => messages.push(message),
    });

    queue.addLine(
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'first prompt' }],
        },
      })
    );
    queue.addLine(
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'second prompt' }],
        },
      })
    );

    expect(queue.size()).toBe(2);
    expect(messages.map((message) => message.message)).toEqual([
      'first prompt',
      'second prompt',
    ]);
    expect(messages.every((message) => message.format === 'stream-json')).toBe(
      true
    );
  });

  test('supports simplified user_prompt frames from the issue contract', () => {
    const queue = new InputQueue({
      inputFormat: 'stream-json',
      autoMerge: true,
    });

    queue.addLine(
      JSON.stringify({
        type: 'user_prompt',
        content: 'hello from user_prompt',
      })
    );

    expect(queue.dequeue()).toMatchObject({
      kind: 'message',
      message: 'hello from user_prompt',
      format: 'stream-json',
    });
  });

  test('normalizes system and interrupt frames', () => {
    expect(
      parseStreamJsonInput(
        JSON.stringify({
          type: 'system',
          content: 'use short answers',
        })
      )
    ).toMatchObject({
      kind: 'system',
      system: 'use short answers',
      format: 'stream-json',
    });

    expect(
      parseStreamJsonInput(
        JSON.stringify({
          type: 'interrupt',
        })
      )
    ).toMatchObject({
      kind: 'interrupt',
      format: 'stream-json',
    });
  });

  test('rejects stream-json user frames without text content', () => {
    expect(() =>
      parseStreamJsonInput(
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'image', source: 'ignored' }],
          },
        })
      )
    ).toThrow('expected message content text');
  });
});
