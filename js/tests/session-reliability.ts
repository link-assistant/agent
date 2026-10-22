import { afterAll, describe, expect, test, setDefaultTimeout } from 'bun:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { APICallError } from 'ai';
import { Instance } from '../src/project/instance';
import { Session } from '../src/session';
import { MessageV2 } from '../src/session/message-v2';
import { SessionProcessor } from '../src/session/processor';
import { SessionPrompt } from '../src/session/prompt';
import { SessionRetry } from '../src/session/retry';
import { SessionStatus } from '../src/session/status';
import { Identifier } from '../src/id/id';
import { config } from '../src/config/config';

/**
 * Session/provider reliability fixes ported from upstream OpenCode (#335):
 * context-overflow compaction, stream-error and retry classification, the
 * tool-call loop exit, interrupted tool bookkeeping, cancel() semantics, retry
 * delay caps and reasoning cost.
 *
 * @see https://github.com/link-assistant/agent/issues/335
 */

setDefaultTimeout(60000);

const directory = await mkdtemp(
  path.join(os.tmpdir(), 'agent-session-reliability-')
);
afterAll(async () => {
  await Instance.disposeAll();
  await rm(directory, { recursive: true, force: true });
});

const callError = (
  input: Partial<ConstructorParameters<typeof APICallError>[0]>
) =>
  new APICallError({
    message: 'error',
    url: 'https://example.invalid/v1',
    requestBodyValues: {},
    ...input,
  });

describe('context overflow classification (#335 item 1)', () => {
  test('400 "prompt is too long" is a ContextOverflowError', () => {
    const error = MessageV2.fromError(
      callError({
        message: 'prompt is too long: 210000 tokens > 200000 maximum',
        statusCode: 400,
        isRetryable: false,
      }),
      { providerID: 'anthropic' }
    );
    expect(error.name).toBe('ContextOverflowError');
  });

  test('413 Request Entity Too Large is a ContextOverflowError', () => {
    const error = MessageV2.fromError(
      callError({ message: 'Request Entity Too Large', statusCode: 413 }),
      { providerID: 'openai' }
    );
    expect(error.name).toBe('ContextOverflowError');
  });

  test('a token rate limit is not mistaken for overflow', () => {
    const error = MessageV2.fromError(
      callError({
        message: 'Rate limit exceeded: too many tokens per minute',
        statusCode: 429,
      }),
      { providerID: 'openai' }
    );
    expect(error.name).toBe('APIError');
  });

  test('a mid-stream context_length_exceeded object is overflow', () => {
    const error = MessageV2.fromError(
      {
        type: 'error',
        error: {
          code: 'context_length_exceeded',
          message: 'Your input exceeds the context window of this model.',
        },
      },
      { providerID: 'openai' }
    );
    expect(error.name).toBe('ContextOverflowError');
  });

  test('assistant messages can persist a ContextOverflowError', () => {
    const parsed = MessageV2.Assistant.safeParse({
      id: 'msg_x',
      sessionID: 'ses_x',
      role: 'assistant',
      time: { created: 0 },
      error: { name: 'ContextOverflowError', data: { message: 'too long' } },
      parentID: 'msg_p',
      modelID: 'm',
      providerID: 'p',
      mode: 'build',
      path: { cwd: '/', root: '/' },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    });
    expect(parsed.success).toBe(true);
  });
});

describe('provider stream-error objects (#335 item 2)', () => {
  test('OpenAI server_error with a string code is a retryable APIError', () => {
    const error = MessageV2.fromError(
      {
        message: 'The server had an error',
        type: 'server_error',
        code: 'server_error',
        statusCode: 500,
        isRetryable: true,
      },
      { providerID: 'openai' }
    );
    expect(error.name).toBe('APIError');
    expect((error as MessageV2.APIError).data.isRetryable).toBe(true);
    expect((error as MessageV2.APIError).data.statusCode).toBe(500);
  });

  test('Anthropic overloaded_error is a retryable APIError', () => {
    const error = MessageV2.fromError(
      {
        message: 'Overloaded',
        type: 'overloaded_error',
        code: 'overloaded_error',
        statusCode: 529,
        isRetryable: true,
      },
      { providerID: 'anthropic' }
    );
    expect(error.name).toBe('APIError');
    expect((error as MessageV2.APIError).data.isRetryable).toBe(true);
  });

  test('insufficient_quota is not retried despite its 429 status', () => {
    const error = MessageV2.fromError(
      {
        message: 'You exceeded your current quota',
        code: 'insufficient_quota',
        statusCode: 429,
        isRetryable: false,
      },
      { providerID: 'openai' }
    );
    expect(error.name).toBe('APIError');
    expect((error as MessageV2.APIError).data.isRetryable).toBe(false);
  });

  test('the SDK isRetryable flag is honoured', () => {
    const error = MessageV2.fromError(
      { message: 'try later', statusCode: 400, isRetryable: true },
      { providerID: 'openai' }
    );
    expect((error as MessageV2.APIError).data.isRetryable).toBe(true);
  });
});

describe('retry classification gaps (#335 item 18)', () => {
  const retryable = (e: unknown, providerID = 'openai-compatible') => {
    const error = MessageV2.fromError(e, { providerID });
    return error.name === 'APIError' && error.data.isRetryable === true;
  };

  test('a 5xx marked non-retryable by the SDK is retried', () => {
    expect(
      retryable(
        callError({
          message: 'Origin timeout',
          statusCode: 524,
          isRetryable: false,
        })
      )
    ).toBe(true);
  });

  test('an unreachable host is still not retried (#290)', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
    });
    expect(
      retryable(callError({ message: 'Cannot connect to API', cause }))
    ).toBe(false);
  });

  test('plain-text rate-limit errors are retried', () => {
    expect(retryable(new Error('Rate limit exceeded, please slow down'))).toBe(
      true
    );
    expect(retryable(new Error('429 Too Many Requests'))).toBe(true);
  });

  test('JSON rate-limit and exhaustion codes are retried', () => {
    expect(
      retryable(
        new Error(
          JSON.stringify({
            type: 'error',
            error: { type: 'too_many_requests' },
          })
        )
      )
    ).toBe(true);
    expect(
      retryable(new Error(JSON.stringify({ code: 'RESOURCE_EXHAUSTED' })))
    ).toBe(true);
    expect(
      retryable(
        new Error(
          JSON.stringify({ type: 'error', error: { code: 'rate_limit_hit' } })
        )
      )
    ).toBe(true);
  });

  test('an OpenAI 404 is retried, other providers are not', () => {
    const notFound = () =>
      callError({ message: 'Item with id rs_1 not found', statusCode: 404 });
    expect(retryable(notFound(), 'openai')).toBe(true);
    expect(retryable(notFound(), 'anthropic')).toBe(false);
  });

  test('a truncated gzip body (ZlibError) is retried', () => {
    const zlib = Object.assign(new Error('Decompression error'), {
      name: 'ZlibError',
      code: 'Z_BUF_ERROR',
    });
    expect(retryable(zlib)).toBe(true);
  });

  test('an ordinary error stays UnknownError', () => {
    expect(
      MessageV2.fromError(new Error('boom'), { providerID: 'x' }).name
    ).toBe('UnknownError');
  });
});

describe('API error messages (#335 item 19)', () => {
  const message = (e: APICallError) =>
    (MessageV2.fromError(e, { providerID: 'openai' }) as MessageV2.APIError)
      .data.message;

  test('a JSON body adds its detail to a generic message', () => {
    expect(
      message(
        callError({
          message: 'Bad Request',
          statusCode: 400,
          responseBody: '{"error":{"message":"tools.0.name invalid"}}',
        })
      )
    ).toContain('tools.0.name invalid');
  });

  test('an HTML gateway page is summarized, not dumped', () => {
    const html = '<!DOCTYPE html><html><body>blocked</body></html>';
    const unauthorized = message(
      callError({
        message: 'Unauthorized',
        statusCode: 401,
        responseBody: html,
      })
    );
    expect(unauthorized).toContain('blocked by a gateway or proxy');
    expect(unauthorized).not.toContain('<html');
    const badGateway = message(
      callError({ message: 'Bad Gateway', statusCode: 502, responseBody: html })
    );
    expect(badGateway).toBe('Bad Gateway');
  });

  test('an empty message falls back to the body', () => {
    expect(
      message(
        callError({ message: '', statusCode: 400, responseBody: 'bad input' })
      )
    ).toBe('bad input');
  });
});

describe('retry delay cap (#335 item 24)', () => {
  const MAX = 2_147_483_647;

  test('retry-after beyond the setTimeout limit is capped', () => {
    const saved = config.retryTimeout;
    config.retryTimeout = 1e7;
    try {
      const error = new MessageV2.APIError({
        message: 'slow down',
        statusCode: 429,
        isRetryable: true,
        responseHeaders: { 'retry-after': '3000000' },
      }).toObject() as MessageV2.APIError;
      expect(SessionRetry.delay(error, 1)).toBeLessThanOrEqual(MAX);
    } finally {
      config.retryTimeout = saved;
    }
  });

  test('backoff and socket delays are capped too', () => {
    const saved = config.maxRetryDelay;
    config.maxRetryDelay = 1e9;
    try {
      const error = new MessageV2.APIError({
        message: 'slow down',
        statusCode: 429,
        isRetryable: true,
        responseHeaders: {},
      }).toObject() as MessageV2.APIError;
      expect(SessionRetry.delay(error, 40)).toBeLessThanOrEqual(MAX);
      expect(SessionRetry.socketErrorDelay(40)).toBeLessThanOrEqual(MAX);
    } finally {
      config.maxRetryDelay = saved;
    }
  });
});

describe('reasoning cost (#335 item 25)', () => {
  const model = { id: 'm', cost: { input: 0, output: 1 } } as any;

  test('reasoning included in outputTokens is charged once', () => {
    const result = Session.getUsage({
      model,
      usage: { inputTokens: 10, outputTokens: 100, reasoningTokens: 60 } as any,
    });
    expect(result.tokens.output).toBe(40);
    expect(result.tokens.reasoning).toBe(60);
    expect(result.cost).toBeCloseTo(100 / 1e6, 12);
  });

  test('AI SDK 7 outputTokenDetails.reasoningTokens is read', () => {
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 10,
        outputTokens: 100,
        outputTokenDetails: { textTokens: 40, reasoningTokens: 60 },
      } as any,
    });
    expect(result.tokens.reasoning).toBe(60);
    expect(result.tokens.output).toBe(40);
    expect(result.cost).toBeCloseTo(100 / 1e6, 12);
  });
});

/** Run `fn` inside an instance with a fresh session that is removed after. */
async function withSession<T>(fn: (sessionID: string) => Promise<T>) {
  return Instance.provide({
    directory,
    fn: async () => {
      const session = await Session.create({});
      try {
        return await fn(session.id);
      } finally {
        await Session.remove(session.id).catch(() => {});
      }
    },
  });
}

async function userMessage(sessionID: string) {
  const user: MessageV2.User = {
    id: Identifier.ascending('message'),
    sessionID,
    role: 'user',
    time: { created: Date.now() },
    agent: 'build',
    model: { providerID: 'formalai', modelID: 'formal-ai' },
  };
  await Session.updateMessage(user);
  return user;
}

async function assistantMessage(
  sessionID: string,
  parentID: string,
  extra: Partial<MessageV2.Assistant> = {}
) {
  const assistant: MessageV2.Assistant = {
    id: Identifier.ascending('message'),
    sessionID,
    role: 'assistant',
    time: { created: Date.now() },
    parentID,
    modelID: 'formal-ai',
    providerID: 'formalai',
    mode: 'build',
    path: { cwd: directory, root: directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...extra,
  };
  await Session.updateMessage(assistant);
  return assistant;
}

/** Feed the processor a scripted stream; `fail` is thrown after the events. */
async function runProcessor(
  sessionID: string,
  events: Record<string, unknown>[],
  options: { fail?: unknown; summary?: boolean } = {}
) {
  const user = await userMessage(sessionID);
  const assistant = await assistantMessage(sessionID, user.id, {
    summary: options.summary,
  });
  const processor = SessionProcessor.create({
    assistantMessage: assistant,
    sessionID,
    providerID: 'formalai',
    model: { id: 'formal-ai', cost: { input: 0, output: 0 } } as any,
    abort: new AbortController().signal,
  });
  const result = await processor.process(
    () =>
      ({
        stream: (async function* () {
          for (const event of events) yield event;
          if (options.fail !== undefined) throw options.fail;
        })(),
      }) as any
  );
  const parts = await MessageV2.parts(assistant.id);
  return { result, parts, message: processor.message };
}

describe('processor tool-call bookkeeping (#335 items 16, 17, 20)', () => {
  test('non-object tool input is stored as { value }', async () => {
    await withSession(async (sessionID) => {
      const { parts } = await runProcessor(
        sessionID,
        [
          { type: 'tool-input-start', id: 'a', toolName: 'invalid' },
          {
            type: 'tool-call',
            toolCallId: 'a',
            toolName: 'invalid',
            input: '{"bad',
            invalid: true,
          },
        ],
        { fail: new Error('stop here') }
      );
      const tool = parts.find((p) => p.type === 'tool') as MessageV2.ToolPart;
      expect(tool.state.input).toEqual({ value: '{"bad' });
    });
  });

  test('an interrupted tool keeps its start time and is marked interrupted', async () => {
    await withSession(async (sessionID) => {
      const before = Date.now();
      const { parts } = await runProcessor(
        sessionID,
        [
          { type: 'tool-input-start', id: 'a', toolName: 'read' },
          { type: 'tool-call', toolCallId: 'a', toolName: 'read', input: {} },
        ],
        {
          fail: await new Promise((resolve) =>
            setTimeout(() => resolve(new Error('connection dropped')), 0)
          ),
        }
      );
      const tool = parts.find((p) => p.type === 'tool') as MessageV2.ToolPart;
      expect(tool.state.status).toBe('error');
      if (tool.state.status !== 'error') return;
      expect(tool.state.metadata?.interrupted).toBe(true);
      expect(tool.state.time.start).toBeGreaterThanOrEqual(before);
      expect(tool.state.time.end).toBeGreaterThanOrEqual(tool.state.time.start);
    });
  });

  test('the running start time survives cleanup', async () => {
    await withSession(async (sessionID) => {
      const events: Record<string, unknown>[] = [
        { type: 'tool-input-start', id: 'a', toolName: 'read' },
        { type: 'tool-call', toolCallId: 'a', toolName: 'read', input: {} },
      ];
      const user = await userMessage(sessionID);
      const assistant = await assistantMessage(sessionID, user.id);
      const processor = SessionProcessor.create({
        assistantMessage: assistant,
        sessionID,
        providerID: 'formalai',
        model: { id: 'formal-ai' } as any,
        abort: new AbortController().signal,
      });
      let runningStart = 0;
      await processor.process(
        () =>
          ({
            stream: (async function* () {
              for (const event of events) yield event;
              const part = processor.partFromToolCall('a');
              if (part?.state.status === 'running')
                runningStart = part.state.time.start;
              await new Promise((resolve) => setTimeout(resolve, 20));
              throw new Error('connection dropped');
            })(),
          }) as any
      );
      const tool = (await MessageV2.parts(assistant.id)).find(
        (p) => p.type === 'tool'
      ) as MessageV2.ToolPart;
      expect(runningStart).toBeGreaterThan(0);
      if (tool.state.status !== 'error') throw new Error('expected error');
      expect(tool.state.time.start).toBe(runningStart);
    });
  });

  test('open text and reasoning parts are finalized on interruption', async () => {
    await withSession(async (sessionID) => {
      const { parts } = await runProcessor(
        sessionID,
        [
          { type: 'reasoning-start', id: 'r' },
          { type: 'reasoning-delta', id: 'r', text: 'thinking' },
          { type: 'text-start', id: 't' },
          { type: 'text-delta', id: 't', text: 'partial' },
        ],
        { fail: new Error('connection dropped') }
      );
      const text = parts.find((p) => p.type === 'text') as MessageV2.TextPart;
      const reasoning = parts.find(
        (p) => p.type === 'reasoning'
      ) as MessageV2.ReasoningPart;
      expect(text.time?.end).toBeNumber();
      expect(reasoning.time.end).toBeNumber();
    });
  });

  test('a tool-call without tool-input-start is persisted', async () => {
    await withSession(async (sessionID) => {
      const { parts } = await runProcessor(
        sessionID,
        [{ type: 'tool-call', toolCallId: 'x', toolName: 'read', input: {} }],
        { fail: new Error('stop here') }
      );
      const tool = parts.find((p) => p.type === 'tool') as MessageV2.ToolPart;
      expect(tool).toBeDefined();
      expect(tool.callID).toBe('x');
    });
  });

  test('a provider-executed tool-call and result are persisted and marked', async () => {
    await withSession(async (sessionID) => {
      const { parts } = await runProcessor(sessionID, [
        {
          type: 'tool-call',
          toolCallId: 'x',
          toolName: 'code_execution',
          input: { code: '1+1' },
          providerExecuted: true,
        },
        {
          type: 'tool-result',
          toolCallId: 'x',
          toolName: 'code_execution',
          input: { code: '1+1' },
          output: '2',
          providerExecuted: true,
        },
      ]);
      const tool = parts.find((p) => p.type === 'tool') as MessageV2.ToolPart;
      expect(tool).toBeDefined();
      expect(tool.state.status).toBe('completed');
      expect(tool.metadata?.providerExecuted).toBe(true);
    });
  });

  test('a tool-result without any earlier event is persisted', async () => {
    await withSession(async (sessionID) => {
      const { parts } = await runProcessor(sessionID, [
        {
          type: 'tool-result',
          toolCallId: 'y',
          toolName: 'web_search',
          input: {},
          output: 'results',
        },
      ]);
      const tool = parts.find((p) => p.type === 'tool') as MessageV2.ToolPart;
      expect(tool?.state.status).toBe('completed');
    });
  });
});

describe('processor context overflow (#335 item 1)', () => {
  const overflow = () =>
    callError({
      message: 'prompt is too long: 70000 tokens > 60000 maximum',
      statusCode: 400,
      isRetryable: false,
    });

  test('overflow asks for compaction instead of failing', async () => {
    await withSession(async (sessionID) => {
      const { result, message } = await runProcessor(sessionID, [], {
        fail: overflow(),
      });
      expect(result).toBe('compact');
      expect(message.error).toBeUndefined();
    });
  });

  test('with auto-compaction disabled overflow stops with the error', async () => {
    const saved = config.disableAutocompact;
    config.disableAutocompact = true;
    try {
      await withSession(async (sessionID) => {
        const { result, message } = await runProcessor(sessionID, [], {
          fail: overflow(),
        });
        expect(result).toBe('stop');
        expect(message.error?.name).toBe('ContextOverflowError');
      });
    } finally {
      config.disableAutocompact = saved;
    }
  });
});

describe('retry-after beyond the retry timeout (#335)', () => {
  // Before: the processor left its retry loop with `break`, skipped the
  // cleanup and returned undefined. The prompt loop only stops on 'stop', so
  // it started another step with a fresh retry budget.
  test('stops the turn with RetryTimeoutExceededError', async () => {
    await withSession(async (sessionID) => {
      const { result, message } = await runProcessor(sessionID, [], {
        fail: callError({
          message: 'Too Many Requests',
          statusCode: 429,
          isRetryable: true,
          responseHeaders: {
            'retry-after': String(config.retryTimeout * 10),
          },
        }),
      });
      expect(result).toBe('stop');
      expect(message.error?.name).toBe('RetryTimeoutExceededError');
      expect(message.time.completed).toBeNumber();
      expect(SessionStatus.get(sessionID).type).not.toBe('retry');
    });
  });

  // Retry-only errors become the message error once their retries run out,
  // so the message schema has to accept them.
  test.each([
    new MessageV2.SocketConnectionError({
      message: 'socket closed',
      isRetryable: true,
    }),
    new MessageV2.TimeoutError({ message: 'timed out', isRetryable: true }),
    new MessageV2.RetryTimeoutExceededError({
      message: 'retry-after too long',
      isRetryable: false,
      retryAfterMs: 2,
      maxTimeoutMs: 1,
    }),
  ])('an assistant message can persist $name', async (error) => {
    await withSession(async (sessionID) => {
      const user = await userMessage(sessionID);
      const assistant = await assistantMessage(sessionID, user.id);
      assistant.error = error.toObject() as MessageV2.Assistant['error'];
      await Session.updateMessage(assistant);
    });
  });
});

describe('loop exit after tool calls (#335 item 3)', () => {
  const part = (state: Record<string, unknown>, metadata?: object) =>
    ({
      id: 'prt_x',
      sessionID: 'ses_x',
      messageID: 'msg_x',
      type: 'tool',
      callID: 'c',
      tool: 'read',
      state,
      metadata,
    }) as MessageV2.Part;

  test('tool calls keep the loop going whatever the finish reason', () => {
    expect(
      SessionPrompt.hasToolCalls([
        part({
          status: 'completed',
          input: {},
          output: '',
          title: '',
          metadata: {},
          time: { start: 0, end: 0 },
        }),
      ])
    ).toBe(true);
    expect(
      SessionPrompt.hasToolCalls([
        part({
          status: 'error',
          input: {},
          error: 'failed',
          time: { start: 0, end: 0 },
        }),
      ])
    ).toBe(true);
  });

  test('provider-executed and interrupted tools do not', () => {
    expect(
      SessionPrompt.hasToolCalls([
        part(
          {
            status: 'completed',
            input: {},
            output: '',
            title: '',
            metadata: {},
            time: { start: 0, end: 0 },
          },
          { providerExecuted: true }
        ),
        part({
          status: 'error',
          input: {},
          error: 'Tool execution aborted',
          metadata: { interrupted: true },
          time: { start: 0, end: 0 },
        }),
      ])
    ).toBe(false);
  });

  test('a finished turn whose only tool was interrupted exits without a model call', async () => {
    await withSession(async (sessionID) => {
      const user = await userMessage(sessionID);
      const assistant = await assistantMessage(sessionID, user.id, {
        finish: 'stop',
        time: { created: Date.now(), completed: Date.now() },
      });
      await Session.updatePart({
        id: Identifier.ascending('part'),
        messageID: assistant.id,
        sessionID,
        type: 'tool',
        callID: 'c',
        tool: 'read',
        state: {
          status: 'error',
          input: {},
          error: 'Tool execution aborted',
          metadata: { interrupted: true },
          time: { start: 1, end: 2 },
        },
      });
      const result = await SessionPrompt.loop(sessionID);
      expect(result.info.id).toBe(assistant.id);
    });
  });
});

describe('cancel() (#335 item 21)', () => {
  test('queued callers are rejected with an AbortError', async () => {
    await withSession(async (sessionID) => {
      const first = SessionPrompt.loop(sessionID).catch(() => {});
      const queued = SessionPrompt.loop(sessionID).then(
        () => 'resolved' as unknown,
        (reason) => reason
      );
      SessionPrompt.cancel(sessionID);
      const reason = await queued;
      await first;
      expect(reason).toBeInstanceOf(DOMException);
      expect((reason as DOMException).name).toBe('AbortError');
    });
  });

  test('cancel without a running loop leaves the session idle', async () => {
    await withSession(async (sessionID) => {
      SessionStatus.set(sessionID, { type: 'busy' });
      SessionPrompt.cancel(sessionID);
      expect(SessionStatus.get(sessionID).type).toBe('idle');
    });
  });
});

/**
 * A fake OpenAI-compatible provider. `respond` gets the 1-based index of each
 * streaming request and returns either an HTTP error or the SSE deltas to send.
 * Non-streaming requests (title/summary) get a plain 400.
 */
type Reply =
  | { status: number; body: unknown }
  | { chunks: { delta: Record<string, unknown>; finish?: string }[] };

async function startProvider(respond: (index: number) => Reply) {
  const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
  const streamRequests: Record<string, any>[] = [];
  const server = createServer((request, response) => {
    if (request.url?.includes('/models')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ object: 'list', data: [{ id: 'formal-ai' }] })
      );
      return;
    }
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      if (!parsed.stream) {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'not supported' } }));
        return;
      }
      streamRequests.push(parsed);
      const reply = respond(streamRequests.length);
      if ('status' in reply) {
        response.writeHead(reply.status, {
          'content-type': 'application/json',
        });
        response.end(JSON.stringify(reply.body));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const { delta, finish } of reply.chunks) {
        response.write(
          `data: ${JSON.stringify({
            id: 'chatcmpl-fake',
            object: 'chat.completion.chunk',
            created: 0,
            model: 'formal-ai',
            choices: [{ index: 0, delta, finish_reason: finish ?? null }],
            ...(finish ? { usage } : {}),
          })}\n\n`
        );
      }
      response.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    streamRequests,
    baseURL: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function runAgent(
  respond: (index: number) => Reply,
  env: Record<string, string> = {}
) {
  const provider = await startProvider(respond);
  try {
    const proc = Bun.spawn({
      cmd: [
        'bun',
        'run',
        'src/index.js',
        '--model',
        'formalai/formal-ai',
        '--no-always-accept-stdin',
        '--no-server',
        '--output-format',
        'stream-json',
      ],
      cwd: process.cwd(),
      stdin: new TextEncoder().encode('do the task\n'),
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        LINK_ASSISTANT_AGENT_COMPACT_JSON: '1',
        LINK_ASSISTANT_AGENT_CONFIG_CONTENT: '{}',
        LINK_ASSISTANT_AGENT_DEFAULT_COMPACTION_MODELS: '(same)',
        LINK_ASSISTANT_AGENT_SUMMARIZE_SESSION: 'false',
        FORMAL_AI_API_KEY: 'local-test-token',
        FORMAL_AI_BASE_URL: provider.baseURL,
        ...env,
      },
    });
    const timer = setTimeout(() => proc.kill(), 50000);
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);
    return {
      // Errors and the final result go to stderr, events to stdout.
      output: `${stdout}\n${stderr}`,
      streamRequests: provider.streamRequests,
      context: `exit=${exitCode}\nrequests=${provider.streamRequests.length}\nstdout:\n${stdout.slice(-6000)}\nstderr:\n${stderr.slice(-3000)}`,
    };
  } finally {
    await provider.close();
  }
}

const text = (content: string): Reply => ({
  chunks: [
    { delta: { role: 'assistant', content } },
    { delta: {}, finish: 'stop' },
  ],
});
const overflowReply: Reply = {
  status: 400,
  body: {
    error: {
      message: 'prompt is too long: 70000 tokens > 60000 maximum',
      type: 'invalid_request_error',
    },
  },
};

describe('agent loop end to end (#335 items 1, 3)', () => {
  test('tool calls reported with finish "stop" still get their results sent back', async () => {
    const run = await runAgent((index) =>
      index === 1
        ? {
            chunks: [
              {
                delta: {
                  role: 'assistant',
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_1',
                      type: 'function',
                      function: { name: 'todoread', arguments: '{}' },
                    },
                  ],
                },
              },
              { delta: {}, finish: 'stop' },
            ],
          }
        : text('done')
    );
    expect(run.streamRequests.length, run.context).toBe(2);
    expect(
      run.streamRequests[1].messages.some((m: any) => m.role === 'tool'),
      run.context
    ).toBe(true);
  });

  test('a context overflow compacts the session and carries on', async () => {
    const run = await runAgent((index) =>
      index === 1 ? overflowReply : index === 2 ? text('summary') : text('done')
    );
    expect(run.streamRequests.length, run.context).toBe(3);
    expect(run.output, run.context).not.toContain('"name":"APIError"');
  });

  test('a compaction request that overflows too stops with a clear error', async () => {
    const run = await runAgent(() => overflowReply);
    expect(run.streamRequests.length, run.context).toBe(2);
    expect(run.output, run.context).toContain(
      'Conversation history too large to compact'
    );
  });

  test('a request that overflows again right after compaction stops', async () => {
    const run = await runAgent((index) =>
      index === 2 ? text('summary') : overflowReply
    );
    expect(run.streamRequests.length, run.context).toBe(3);
    expect(run.output, run.context).toContain('ContextOverflowError');
  });

  test('with auto-compaction disabled the overflow is reported as is', async () => {
    const run = await runAgent(() => overflowReply, {
      LINK_ASSISTANT_AGENT_DISABLE_AUTOCOMPACT: 'true',
    });
    expect(run.streamRequests.length, run.context).toBe(1);
    expect(run.output, run.context).toContain('ContextOverflowError');
  });
});

/**
 * prompt.ts passed the provider id where `maxOutputTokens` expects the npm
 * package, so the Anthropic thinking-budget branch never ran and
 * `max_tokens` (text + thinking) could exceed the model's output cap.
 */
describe('maxOutputTokens uses the npm package (#335 own-bug 3)', () => {
  test('anthropic thinking budget is kept within the model output cap', async () => {
    const bodies: Record<string, any>[] = [];
    const server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        bodies.push(JSON.parse(body || '{}'));
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            type: 'error',
            error: { type: 'invalid_request_error', message: 'stop' },
          })
        );
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve())
    );
    const { port } = server.address() as AddressInfo;
    try {
      const proc = Bun.spawn({
        cmd: [
          'bun',
          'run',
          'src/index.js',
          '--model',
          'thinkcap/think-model',
          '--no-always-accept-stdin',
          '--no-server',
          '--output-format',
          'stream-json',
        ],
        cwd: process.cwd(),
        stdin: new TextEncoder().encode('hi\n'),
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...process.env,
          LINK_ASSISTANT_AGENT_COMPACT_JSON: '1',
          LINK_ASSISTANT_AGENT_DEFAULT_COMPACTION_MODELS: '(same)',
          LINK_ASSISTANT_AGENT_SUMMARIZE_SESSION: 'false',
          LINK_ASSISTANT_AGENT_CONFIG_CONTENT: JSON.stringify({
            provider: {
              thinkcap: {
                name: 'thinkcap',
                npm: '@ai-sdk/anthropic',
                options: {
                  baseURL: `http://127.0.0.1:${port}/v1`,
                  apiKey: 'local-test-token',
                },
                models: {
                  'think-model': {
                    name: 'think-model',
                    tool_call: true,
                    limit: { context: 200000, output: 64000 },
                    options: {
                      thinking: { type: 'enabled', budgetTokens: 60000 },
                    },
                  },
                },
              },
            },
          }),
        },
      });
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      const streamed = bodies.filter((b) => b.stream);
      const context = `bodies=${JSON.stringify(streamed.map((b) => b.max_tokens))}\nstdout:\n${stdout.slice(-3000)}\nstderr:\n${stderr.slice(-2000)}`;
      expect(streamed.length, context).toBeGreaterThan(0);
      expect(streamed[0].max_tokens, context).toBeLessThanOrEqual(64000);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
