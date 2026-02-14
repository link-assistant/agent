import type { ModelsDev } from '../provider/models';
import { MessageV2 } from './message-v2';
import { type StreamTextResult, type Tool as AITool, APICallError } from 'ai';
import { Log } from '../util/log';
import { Identifier } from '../id/id';
import { Session } from '.';
import { Agent } from '../agent/agent';
// Permission system removed - no restrictions
import { Snapshot } from '../snapshot';
import { SessionSummary } from './summary';
import { Bus } from '../bus';
import { SessionRetry } from './retry';
import { SessionStatus } from './status';

export namespace SessionProcessor {
  const DOOM_LOOP_THRESHOLD = 3;
  const log = Log.create({ service: 'session.processor' });

  export type Info = Awaited<ReturnType<typeof create>>;
  export type Result = Awaited<ReturnType<Info['process']>>;

  export function create(input: {
    assistantMessage: MessageV2.Assistant;
    sessionID: string;
    providerID: string;
    model: ModelsDev.Model;
    abort: AbortSignal;
  }) {
    const toolcalls: Record<string, MessageV2.ToolPart> = {};
    let snapshot: string | undefined;
    let blocked = false;
    let attempt = 0;

    const result = {
      get message() {
        return input.assistantMessage;
      },
      partFromToolCall(toolCallID: string) {
        return toolcalls[toolCallID];
      },
      async process(fn: () => StreamTextResult<Record<string, AITool>, never>) {
        log.info(() => ({ message: 'process' }));
        while (true) {
          try {
            let currentText: MessageV2.TextPart | undefined;
            let reasoningMap: Record<string, MessageV2.ReasoningPart> = {};
            const stream = fn();

            for await (const value of stream.fullStream) {
              input.abort.throwIfAborted();
              switch (value.type) {
                case 'start':
                  SessionStatus.set(input.sessionID, { type: 'busy' });
                  break;

                case 'reasoning-start':
                  if (value.id in reasoningMap) {
                    continue;
                  }
                  reasoningMap[value.id] = {
                    id: Identifier.ascending('part'),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: 'reasoning',
                    text: '',
                    time: {
                      start: Date.now(),
                    },
                    metadata: value.providerMetadata,
                  };
                  break;

                case 'reasoning-delta':
                  if (value.id in reasoningMap) {
                    const part = reasoningMap[value.id];
                    part.text += value.text;
                    if (value.providerMetadata)
                      part.metadata = value.providerMetadata;
                    if (part.text)
                      await Session.updatePart({ part, delta: value.text });
                  }
                  break;

                case 'reasoning-end':
                  if (value.id in reasoningMap) {
                    const part = reasoningMap[value.id];
                    part.text = part.text.trimEnd();

                    part.time = {
                      ...part.time,
                      end: Date.now(),
                    };
                    if (value.providerMetadata)
                      part.metadata = value.providerMetadata;
                    await Session.updatePart(part);
                    delete reasoningMap[value.id];
                  }
                  break;

                case 'tool-input-start':
                  const part = await Session.updatePart({
                    id: toolcalls[value.id]?.id ?? Identifier.ascending('part'),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: 'tool',
                    tool: value.toolName,
                    callID: value.id,
                    state: {
                      status: 'pending',
                      input: {},
                      raw: '',
                    },
                  });
                  toolcalls[value.id] = part as MessageV2.ToolPart;
                  break;

                case 'tool-input-delta':
                  break;

                case 'tool-input-end':
                  break;

                case 'tool-call': {
                  const match = toolcalls[value.toolCallId];
                  if (match) {
                    const part = await Session.updatePart({
                      ...match,
                      tool: value.toolName,
                      state: {
                        status: 'running',
                        input: value.input,
                        time: {
                          start: Date.now(),
                        },
                      },
                      metadata: value.providerMetadata,
                    });
                    toolcalls[value.toolCallId] = part as MessageV2.ToolPart;

                    const parts = await MessageV2.parts(
                      input.assistantMessage.id
                    );
                    const lastThree = parts.slice(-DOOM_LOOP_THRESHOLD);

                    if (
                      lastThree.length === DOOM_LOOP_THRESHOLD &&
                      lastThree.every(
                        (p) =>
                          p.type === 'tool' &&
                          p.tool === value.toolName &&
                          p.state.status !== 'pending' &&
                          JSON.stringify(p.state.input) ===
                            JSON.stringify(value.input)
                      )
                    ) {
                      // Permission system removed - doom loop detection disabled
                    }
                  }
                  break;
                }
                case 'tool-result': {
                  const match = toolcalls[value.toolCallId];
                  if (match && match.state.status === 'running') {
                    await Session.updatePart({
                      ...match,
                      state: {
                        status: 'completed',
                        input: value.input,
                        output: value.output.output,
                        metadata: value.output.metadata,
                        title: value.output.title,
                        time: {
                          start: match.state.time.start,
                          end: Date.now(),
                        },
                        attachments: value.output.attachments,
                      },
                    });

                    delete toolcalls[value.toolCallId];
                  }
                  break;
                }

                case 'tool-error': {
                  const match = toolcalls[value.toolCallId];
                  if (match && match.state.status === 'running') {
                    await Session.updatePart({
                      ...match,
                      state: {
                        status: 'error',
                        input: value.input,
                        error: (value.error as any).toString(),
                        metadata: undefined,
                        time: {
                          start: match.state.time.start,
                          end: Date.now(),
                        },
                      },
                    });

                    // Permission system removed
                    delete toolcalls[value.toolCallId];
                  }
                  break;
                }
                case 'error':
                  throw value.error;

                case 'start-step':
                  snapshot = await Snapshot.track();
                  await Session.updatePart({
                    id: Identifier.ascending('part'),
                    messageID: input.assistantMessage.id,
                    sessionID: input.sessionID,
                    snapshot,
                    type: 'step-start',
                  });
                  break;

                case 'finish-step':
                  // Safely handle missing or undefined usage data
                  // Some providers (e.g., OpenCode with Kimi K2.5) may return incomplete usage
                  // See: https://github.com/link-assistant/agent/issues/152
                  const safeUsage = value.usage ?? {
                    inputTokens: 0,
                    outputTokens: 0,
                    totalTokens: 0,
                  };
                  const usage = Session.getUsage({
                    model: input.model,
                    usage: safeUsage,
                    metadata: value.providerMetadata,
                  });
                  // Use toFinishReason to safely convert object/string finishReason to string
                  // See: https://github.com/link-assistant/agent/issues/125
                  const finishReason = Session.toFinishReason(
                    value.finishReason
                  );
                  input.assistantMessage.finish = finishReason;
                  input.assistantMessage.cost += usage.cost;
                  input.assistantMessage.tokens = usage.tokens;
                  await Session.updatePart({
                    id: Identifier.ascending('part'),
                    reason: finishReason,
                    snapshot: await Snapshot.track(),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: 'step-finish',
                    tokens: usage.tokens,
                    cost: usage.cost,
                  });
                  await Session.updateMessage(input.assistantMessage);
                  if (snapshot) {
                    const patch = await Snapshot.patch(snapshot);
                    if (patch.files.length) {
                      await Session.updatePart({
                        id: Identifier.ascending('part'),
                        messageID: input.assistantMessage.id,
                        sessionID: input.sessionID,
                        type: 'patch',
                        hash: patch.hash,
                        files: patch.files,
                      });
                    }
                    snapshot = undefined;
                  }
                  SessionSummary.summarize({
                    sessionID: input.sessionID,
                    messageID: input.assistantMessage.parentID,
                  });
                  break;

                case 'text-start':
                  currentText = {
                    id: Identifier.ascending('part'),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: 'text',
                    text: '',
                    time: {
                      start: Date.now(),
                    },
                    metadata: value.providerMetadata,
                  };
                  break;

                case 'text-delta':
                  if (currentText) {
                    // Handle case where value.text might be an object instead of string
                    // See: https://github.com/link-assistant/agent/issues/125
                    const textDelta =
                      typeof value.text === 'string'
                        ? value.text
                        : String(value.text);
                    currentText.text += textDelta;
                    if (value.providerMetadata)
                      currentText.metadata = value.providerMetadata;
                    if (currentText.text)
                      await Session.updatePart({
                        part: currentText,
                        delta: textDelta,
                      });
                  }
                  break;

                case 'text-end':
                  if (currentText) {
                    currentText.text = currentText.text.trimEnd();
                    currentText.time = {
                      start: Date.now(),
                      end: Date.now(),
                    };
                    if (value.providerMetadata)
                      currentText.metadata = value.providerMetadata;
                    await Session.updatePart(currentText);
                  }
                  currentText = undefined;
                  break;

                case 'finish':
                  input.assistantMessage.time.completed = Date.now();
                  await Session.updateMessage(input.assistantMessage);
                  // Clear retry state on successful completion
                  SessionRetry.clearRetryState(input.sessionID);
                  break;

                default:
                  log.info(() => ({ message: 'unhandled', ...value }));
                  continue;
              }
            }
          } catch (e) {
            log.error(() => ({ message: 'process', error: e }));

            // Check for AI SDK usage-related TypeError (input_tokens undefined)
            // This happens when providers return incomplete usage data
            // See: https://github.com/link-assistant/agent/issues/152
            if (
              e instanceof TypeError &&
              (e.message.includes('input_tokens') ||
                e.message.includes('output_tokens') ||
                e.message.includes("reading 'input_tokens'") ||
                e.message.includes("reading 'output_tokens'"))
            ) {
              log.warn(() => ({
                message:
                  'Provider returned invalid usage data, continuing with zero usage',
                errorMessage: e.message,
                providerID: input.providerID,
              }));
              // Set default token values to prevent crash
              input.assistantMessage.tokens = {
                input: 0,
                output: 0,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              };
              // Continue processing instead of failing
              continue;
            }

            const error = MessageV2.fromError(e, {
              providerID: input.providerID,
            });

            // Check if error is retryable (APIError, SocketConnectionError, TimeoutError, or StreamParseError)
            const isRetryableAPIError =
              error?.name === 'APIError' && error.data.isRetryable;
            const isRetryableSocketError =
              error?.name === 'SocketConnectionError' &&
              error.data.isRetryable &&
              attempt < SessionRetry.SOCKET_ERROR_MAX_RETRIES;
            const isRetryableTimeoutError =
              error?.name === 'TimeoutError' &&
              error.data.isRetryable &&
              attempt < SessionRetry.TIMEOUT_MAX_RETRIES;
            // Stream parse errors are transient (malformed JSON from provider)
            // and should be retried with exponential backoff
            // See: https://github.com/link-assistant/agent/issues/169
            const isRetryableStreamParseError =
              error?.name === 'StreamParseError' &&
              error.data.isRetryable &&
              attempt < SessionRetry.STREAM_PARSE_ERROR_MAX_RETRIES;

            // For API errors (rate limits), check if we're within the retry timeout
            // See: https://github.com/link-assistant/agent/issues/157
            const retryCheck = isRetryableAPIError
              ? SessionRetry.shouldRetry(
                  input.sessionID,
                  error.data.statusCode?.toString() ?? 'unknown'
                )
              : { shouldRetry: true, elapsedTime: 0, maxTime: 0 };

            if (
              (isRetryableAPIError && retryCheck.shouldRetry) ||
              isRetryableSocketError ||
              isRetryableTimeoutError ||
              isRetryableStreamParseError
            ) {
              attempt++;
              // Use error-specific delay calculation
              // SessionRetry.delay may throw RetryTimeoutExceededError if retry-after exceeds timeout
              let delay: number;
              try {
                delay =
                  error?.name === 'SocketConnectionError'
                    ? SessionRetry.socketErrorDelay(attempt)
                    : error?.name === 'TimeoutError'
                      ? SessionRetry.timeoutDelay(attempt)
                      : error?.name === 'StreamParseError'
                        ? SessionRetry.streamParseErrorDelay(attempt)
                        : SessionRetry.delay(error, attempt);
              } catch (delayError) {
                // If retry-after exceeds AGENT_RETRY_TIMEOUT, fail immediately
                if (
                  delayError instanceof SessionRetry.RetryTimeoutExceededError
                ) {
                  log.error(() => ({
                    message: 'retry-after exceeds timeout, failing immediately',
                    retryAfterMs: delayError.retryAfterMs,
                    maxTimeoutMs: delayError.maxTimeoutMs,
                  }));
                  SessionRetry.clearRetryState(input.sessionID);
                  // Create a specific error for this case
                  input.assistantMessage.error = {
                    name: 'RetryTimeoutExceededError',
                    data: {
                      message: delayError.message,
                      isRetryable: false,
                      retryAfterMs: delayError.retryAfterMs,
                      maxTimeoutMs: delayError.maxTimeoutMs,
                    },
                  } as MessageV2.Error;
                  Bus.publish(Session.Event.Error, {
                    sessionID: input.assistantMessage.sessionID,
                    error: input.assistantMessage.error,
                  });
                  break;
                }
                throw delayError;
              }
              log.info(() => ({
                message: 'retrying',
                errorType: error?.name,
                attempt,
                delay,
                elapsedRetryTime: retryCheck.elapsedTime,
                maxRetryTime: retryCheck.maxTime,
              }));
              SessionStatus.set(input.sessionID, {
                type: 'retry',
                attempt,
                message: error.data.message,
                next: Date.now() + delay,
              });
              // Update retry state to track total time
              SessionRetry.updateRetryState(input.sessionID, delay);
              await SessionRetry.sleep(delay, input.abort).catch(() => {});
              continue;
            }

            // Clear retry state on non-retryable error
            SessionRetry.clearRetryState(input.sessionID);
            input.assistantMessage.error = error;
            Bus.publish(Session.Event.Error, {
              sessionID: input.assistantMessage.sessionID,
              error: input.assistantMessage.error,
            });
          }
          const p = await MessageV2.parts(input.assistantMessage.id);
          for (const part of p) {
            if (
              part.type === 'tool' &&
              part.state.status !== 'completed' &&
              part.state.status !== 'error'
            ) {
              await Session.updatePart({
                ...part,
                state: {
                  ...part.state,
                  status: 'error',
                  error: 'Tool execution aborted',
                  time: {
                    start: Date.now(),
                    end: Date.now(),
                  },
                },
              });
            }
          }
          input.assistantMessage.time.completed = Date.now();
          await Session.updateMessage(input.assistantMessage);
          if (blocked) return 'stop';
          if (input.assistantMessage.error) return 'stop';
          return 'continue';
        }
      },
    };
    return result;
  }
}
