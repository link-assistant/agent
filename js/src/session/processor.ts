import type { ModelsDev } from '../provider/models';
import { MessageV2 } from './message-v2';
import {
  type StreamTextResult,
  type Tool as AITool,
  APICallError,
  JSONParseError,
} from 'ai';
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
import { config, isVerbose } from '../config/config';
import { SessionCompaction } from './compaction';
import { SSEUsageExtractor } from '../util/sse-usage-extractor';
import { Tool } from '../tool/tool';

export namespace SessionProcessor {
  const DOOM_LOOP_THRESHOLD = 3;
  const log = Log.create({ service: 'session.processor' });

  /**
   * Detect model-not-supported errors from an API response body.
   *
   * Some providers (e.g., OpenCode, OpenRouter) return HTTP 401 with a body
   * like {"type":"ModelError","message":"Model X not supported"} instead of
   * the semantically correct 400/404. Without this check the error looks like
   * an authentication failure, making diagnostics confusing.
   *
   * See: https://github.com/link-assistant/agent/issues/208
   */
  export function isModelNotSupportedError(responseBody: string): boolean {
    try {
      const parsed = JSON.parse(responseBody);
      // OpenCode/OpenRouter format: {"type":"error","error":{"type":"ModelError","message":"..."}}
      if (parsed?.error?.type === 'ModelError') return true;
      // Flat format: {"type":"ModelError","message":"..."}
      if (parsed?.type === 'ModelError') return true;
      return false;
    } catch {
      // If response body is not JSON, check for common text patterns
      return (
        responseBody.includes('ModelError') ||
        responseBody.toLowerCase().includes('model not supported') ||
        responseBody.toLowerCase().includes('model not found')
      );
    }
  }

  /**
   * Detect AI SDK/provider usage-shape crashes.
   *
   * Some provider error streams end before a valid finish-step usage object is
   * available. Depending on the provider adapter, that can surface as a
   * TypeError while reading token fields instead of the original provider
   * error. Treat it as retryable provider failure rather than a generic crash.
   *
   * See: https://github.com/link-assistant/agent/issues/264
   */
  export function isUsageDataTypeError(error: unknown): boolean {
    const message =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : typeof error === 'string'
          ? error
          : '';

    if (!(error instanceof TypeError) && !message.startsWith('TypeError:')) {
      return false;
    }

    return [
      'input_tokens',
      'output_tokens',
      'usage.inputTokens',
      'usage.outputTokens',
      'inputTokens.total',
      'outputTokens.total',
      "reading 'inputTokens'",
      "reading 'outputTokens'",
    ].some((pattern) => message.includes(pattern));
  }

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
    let needsCompaction = false;

    // Providers may send tool-call / tool-result without tool-input-start
    // (provider-executed tools, some OpenAI-compatible gateways); the part
    // must still exist or the call is silently dropped (upstream #24151).
    async function ensureToolCall(
      id: string,
      toolName: string,
      providerExecuted?: boolean
    ) {
      const existing = toolcalls[id];
      if (existing) {
        if (!providerExecuted || existing.metadata?.providerExecuted)
          return existing;
        const part = (await Session.updatePart({
          ...existing,
          metadata: { ...existing.metadata, providerExecuted: true },
        })) as MessageV2.ToolPart;
        toolcalls[id] = part;
        return part;
      }
      const part = (await Session.updatePart({
        id: Identifier.ascending('part'),
        messageID: input.assistantMessage.id,
        sessionID: input.assistantMessage.sessionID,
        type: 'tool',
        tool: toolName,
        callID: id,
        state: { status: 'pending', input: {}, raw: '' },
        metadata: providerExecuted ? { providerExecuted: true } : undefined,
      })) as MessageV2.ToolPart;
      toolcalls[id] = part;
      return part;
    }

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
          // Outside the try so cleanup can finalize parts left open by an
          // interrupted stream (upstream #16776).
          let currentText: MessageV2.TextPart | undefined;
          let reasoningMap: Record<string, MessageV2.ReasoningPart> = {};
          try {
            const stream = fn();

            for await (const value of stream.stream) {
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
                  const match = await ensureToolCall(
                    value.toolCallId,
                    value.toolName,
                    value.providerExecuted
                  );
                  {
                    // Invalid tool calls carry the raw string; the part schema
                    // needs a record (upstream #14862).
                    const toolInput =
                      value.input &&
                      typeof value.input === 'object' &&
                      !Array.isArray(value.input)
                        ? (value.input as Record<string, any>)
                        : { value: value.input };
                    const part = await Session.updatePart({
                      ...match,
                      tool: value.toolName,
                      state:
                        match.state.status === 'running'
                          ? { ...match.state, input: toolInput }
                          : {
                              status: 'running',
                              input: toolInput,
                              time: {
                                start: Date.now(),
                              },
                            },
                      metadata: match.metadata?.providerExecuted
                        ? { ...value.providerMetadata, providerExecuted: true }
                        : value.providerMetadata,
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
                  const match = await ensureToolCall(
                    value.toolCallId,
                    value.toolName,
                    value.providerExecuted
                  );
                  if (
                    match.state.status === 'running' ||
                    match.state.status === 'pending'
                  ) {
                    const output = value.output as unknown;
                    const toolInput =
                      value.input &&
                      typeof value.input === 'object' &&
                      !Array.isArray(value.input)
                        ? (value.input as Record<string, any>)
                        : { value: value.input };
                    const time = {
                      start:
                        match.state.status === 'running'
                          ? match.state.time.start
                          : Date.now(),
                      end: Date.now(),
                    };
                    await Session.updatePart({
                      ...match,
                      // Provider-executed tools return raw values rather than
                      // a Tool.Result.
                      state:
                        output &&
                        typeof output === 'object' &&
                        typeof (output as { output?: unknown }).output ===
                          'string'
                          ? Tool.toState(output as Tool.Result, {
                              input: toolInput,
                              time,
                            })
                          : {
                              status: 'completed',
                              input: toolInput,
                              output:
                                typeof output === 'string'
                                  ? output
                                  : (JSON.stringify(output) ?? ''),
                              title: '',
                              metadata: {},
                              time,
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
                  // Skip stream parse errors (malformed SSE from gateway/provider)
                  // The AI SDK emits these as error events but continues the stream.
                  // Following OpenAI Codex pattern: log and skip bad events.
                  // See: https://github.com/link-assistant/agent/issues/169
                  if (JSONParseError.isInstance(value.error)) {
                    log.warn(() => ({
                      message:
                        'skipping malformed SSE event (stream parse error)',
                      errorName: (value.error as Error)?.name,
                      errorMessage: (value.error as Error)?.message?.substring(
                        0,
                        200
                      ),
                    }));
                    continue;
                  }
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
                  // Also check providerMetadata for finish reason if undefined
                  // OpenRouter-compatible APIs (like Kilo) may not populate finishReason in standard location
                  // See: https://github.com/link-assistant/agent/issues/187
                  let rawFinishReason = value.finishReason;
                  if (rawFinishReason === undefined) {
                    // Try to extract from OpenRouter provider metadata
                    // The openrouter metadata may contain finish_reason or other indicators
                    const openrouterMeta =
                      value.providerMetadata?.['openrouter'];
                    if (openrouterMeta) {
                      // OpenRouter sometimes includes reason in reasoning_details or annotations
                      // For now, if we have usage data, we can assume it completed successfully
                      if (openrouterMeta['usage']) {
                        rawFinishReason = 'stop';
                      }
                    }
                  }

                  // CRITICAL FIX for issue #194: Infer finish reason from tool calls
                  // If finishReason is still undefined but we have pending tool calls,
                  // the model intended to make tool calls - infer 'tool-calls' as the reason.
                  // This prevents premature loop exit when providers don't return finishReason.
                  // See: https://github.com/link-assistant/agent/issues/194
                  if (rawFinishReason === undefined) {
                    const pendingToolCallCount = Object.keys(toolcalls).length;
                    if (pendingToolCallCount > 0) {
                      log.info(() => ({
                        message:
                          'inferred tool-calls finish reason from pending tool calls',
                        pendingToolCallCount,
                        providerID: input.providerID,
                        hint: 'Provider returned undefined finishReason but made tool calls',
                      }));
                      rawFinishReason = 'tool-calls';
                    }
                  }

                  const finishReason = Session.toFinishReason(rawFinishReason);
                  input.assistantMessage.finish = finishReason;
                  input.assistantMessage.cost += usage.cost;
                  input.assistantMessage.tokens = usage.tokens;

                  // Log raw usage data at step level for debugging token parsing issues.
                  // The AI SDK may drop token data between the raw HTTP response and the
                  // finish-step event (e.g., @ai-sdk/openai-compatible may not propagate
                  // usage from SSE stream chunks). This log helps detect such mismatches.
                  // @see https://github.com/link-assistant/agent/issues/249
                  if (isVerbose()) {
                    log.debug(() => ({
                      message: 'step-finish raw usage diagnostics',
                      providerID: input.providerID,
                      modelID: input.model.id,
                      parsedTokens: usage.tokens,
                      rawUsage: JSON.stringify(value.usage ?? null),
                      rawProviderMetadata: JSON.stringify(
                        value.providerMetadata ?? null
                      ),
                      rawFinishReason: String(
                        value.finishReason ?? 'undefined'
                      ),
                      respondedModelID:
                        (value as any).response?.modelId ?? 'none',
                    }));
                  }

                  // When AI SDK returns zero tokens, try to recover usage from
                  // raw SSE stream data captured by the fetch interceptor.
                  // The AI SDK may drop token data between the raw HTTP response
                  // and the finish-step event (known bug in @ai-sdk/openai-compatible).
                  // @see https://github.com/link-assistant/agent/issues/249
                  if (
                    usage.tokens.input === 0 &&
                    usage.tokens.output === 0 &&
                    usage.tokens.reasoning === 0
                  ) {
                    const sseUsage = SSEUsageExtractor.consumeLatestUsage();
                    if (sseUsage) {
                      const recoveredUsage = Session.getUsage({
                        model: input.model,
                        usage: {
                          inputTokens: sseUsage.promptTokens,
                          outputTokens: sseUsage.completionTokens,
                          totalTokens: sseUsage.totalTokens,
                          reasoningTokens: sseUsage.reasoningTokens ?? 0,
                          cachedInputTokens: sseUsage.cachedTokens ?? 0,
                        },
                        metadata: value.providerMetadata,
                      });
                      input.assistantMessage.cost =
                        input.assistantMessage.cost -
                        usage.cost +
                        recoveredUsage.cost;
                      input.assistantMessage.tokens = recoveredUsage.tokens;
                      log.warn(() => ({
                        message:
                          'recovered usage from raw SSE stream — AI SDK dropped token data',
                        providerID: input.providerID,
                        requestedModelID: input.model.id,
                        recoveredTokens: recoveredUsage.tokens,
                        recoveredCost: recoveredUsage.cost,
                        ssePromptTokens: sseUsage.promptTokens,
                        sseCompletionTokens: sseUsage.completionTokens,
                        issue:
                          'https://github.com/link-assistant/agent/issues/249',
                      }));
                      // Update the step-finish part with recovered data
                      usage.tokens = recoveredUsage.tokens;
                      usage.cost = recoveredUsage.cost;
                    } else {
                      log.warn(() => ({
                        message:
                          'provider returned zero tokens at step level — AI SDK may not be propagating usage from raw HTTP response',
                        providerID: input.providerID,
                        requestedModelID: input.model.id,
                        respondedModelID:
                          (value as any).response?.modelId ?? 'none',
                        finishReason,
                        rawFinishReason: String(
                          value.finishReason ?? 'undefined'
                        ),
                        rawUsage: JSON.stringify(value.usage ?? null),
                        providerMetadata: JSON.stringify(
                          value.providerMetadata ?? null
                        ),
                        hint: 'No raw SSE usage found either. The token estimation fallback in isOverflow() handles this case.',
                        issue:
                          'https://github.com/link-assistant/agent/issues/249',
                      }));
                    }
                  }

                  // Build model info if --output-response-model flag is enabled
                  // @see https://github.com/link-assistant/agent/issues/179
                  const modelInfo: MessageV2.ModelInfo | undefined =
                    config.outputResponseModel
                      ? {
                          providerID: input.providerID,
                          requestedModelID: input.model.id,
                          // Get respondedModelID from finish-step response if available
                          // AI SDK includes response.modelId when available from provider
                          respondedModelID:
                            (value as any).response?.modelId ?? undefined,
                        }
                      : undefined;

                  // Compute context diagnostics for JSON output
                  // @see https://github.com/link-assistant/agent/issues/217
                  const contextDiag = SessionCompaction.contextDiagnostics({
                    tokens: usage.tokens,
                    model: input.model,
                  });

                  if (isVerbose() && contextDiag) {
                    log.info(() => ({
                      message: 'step-finish context diagnostics',
                      providerID: input.providerID,
                      modelID: input.model.id,
                      ...contextDiag,
                    }));
                  }

                  await Session.updatePart({
                    id: Identifier.ascending('part'),
                    reason: finishReason,
                    snapshot: await Snapshot.track(),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: 'step-finish',
                    tokens: usage.tokens,
                    cost: usage.cost,
                    model: modelInfo,
                    context: contextDiag,
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
                  // Fire-and-forget on purpose, and guarded: a summarization
                  // failure must not become an unhandled rejection that exits
                  // the process while this stream is still being processed.
                  // See: https://github.com/link-assistant/agent/issues/304
                  void SessionSummary.summarize({
                    sessionID: input.sessionID,
                    messageID: input.assistantMessage.parentID,
                  }).catch((error) => {
                    log.warn(() => ({
                      message: 'session summarization failed',
                      sessionID: input.sessionID,
                      error:
                        error instanceof Error ? error.message : String(error),
                    }));
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
                      start: currentText.time?.start ?? Date.now(),
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

            let error = MessageV2.fromError(e, {
              providerID: input.providerID,
            });

            // Check for AI SDK usage-related TypeErrors. These usually come
            // from provider adapters after malformed/incomplete usage data, so
            // retry them with normal API-error backoff instead of surfacing a
            // misleading UnknownError.
            if (isUsageDataTypeError(e)) {
              log.warn(() => ({
                message:
                  'provider returned invalid usage data; retrying as provider API error',
                errorMessage: e instanceof Error ? e.message : String(e),
                providerID: input.providerID,
                issue: 'https://github.com/link-assistant/agent/issues/264',
              }));
              error = new MessageV2.APIError(
                {
                  message:
                    e instanceof Error
                      ? e.message
                      : 'Provider returned invalid usage data',
                  isRetryable: true,
                },
                { cause: e }
              ).toObject();
            }

            // Overflow is handled by compacting the session and trying again,
            // not by retrying the same oversized request (upstream #14707).
            if (error?.name === 'ContextOverflowError') {
              SessionRetry.clearRetryState(input.sessionID);
              if (
                config.disableAutocompact &&
                !input.assistantMessage.summary
              ) {
                input.assistantMessage.error = error;
                Bus.publish(Session.Event.Error, {
                  sessionID: input.assistantMessage.sessionID,
                  error: input.assistantMessage.error,
                });
              } else {
                log.info(() => ({
                  message: 'context overflow, requesting compaction',
                  providerID: input.providerID,
                  modelID: input.model.id,
                }));
                needsCompaction = true;
              }
            } else {
              // Check if error is retryable (APIError, SocketConnectionError, TimeoutError)
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

              // For API errors (rate limits), check if we're within the retry timeout
              // See: https://github.com/link-assistant/agent/issues/157
              const retryCheck = isRetryableAPIError
                ? SessionRetry.shouldRetry(
                    input.sessionID,
                    error.data.statusCode?.toString() ?? 'unknown'
                  )
                : { shouldRetry: true, elapsedTime: 0, maxTime: 0 };

              let delay: number | undefined;
              if (
                (isRetryableAPIError && retryCheck.shouldRetry) ||
                isRetryableSocketError ||
                isRetryableTimeoutError
              ) {
                attempt++;
                // Use error-specific delay calculation
                // SessionRetry.delay may throw RetryTimeoutExceededError if retry-after exceeds timeout
                try {
                  delay =
                    error?.name === 'SocketConnectionError'
                      ? SessionRetry.socketErrorDelay(attempt)
                      : error?.name === 'TimeoutError'
                        ? SessionRetry.timeoutDelay(attempt)
                        : SessionRetry.delay(error, attempt);
                } catch (delayError) {
                  // If retry-after exceeds LINK_ASSISTANT_AGENT_RETRY_TIMEOUT, fail immediately
                  if (
                    delayError instanceof SessionRetry.RetryTimeoutExceededError
                  ) {
                    log.error(() => ({
                      message:
                        'retry-after exceeds timeout, failing immediately',
                      retryAfterMs: delayError.retryAfterMs,
                      maxTimeoutMs: delayError.maxTimeoutMs,
                    }));
                    // Report it like any other final error below. Leaving
                    // the loop with `break` skipped the cleanup and returned
                    // undefined, so the prompt loop started another step.
                    error = new MessageV2.RetryTimeoutExceededError(
                      {
                        message: delayError.message,
                        isRetryable: false,
                        retryAfterMs: delayError.retryAfterMs,
                        maxTimeoutMs: delayError.maxTimeoutMs,
                      },
                      { cause: delayError }
                    ).toObject();
                  } else throw delayError;
                }
              }
              if (delay !== undefined) {
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

              // Detect model-not-supported errors from provider response body.
              // OpenCode and similar proxies return HTTP 401 with
              // {"type":"ModelError","message":"Model X not supported"}.
              // Without this check the error looks like an auth failure (401),
              // but it's actually a model-availability issue.
              // See: https://github.com/link-assistant/agent/issues/208
              if (
                error?.name === 'APIError' &&
                error.data.statusCode === 401 &&
                error.data.responseBody
              ) {
                const isModelError = isModelNotSupportedError(
                  error.data.responseBody
                );
                if (isModelError) {
                  log.error(() => ({
                    message:
                      'model not supported by provider — this is NOT an auth error',
                    hint: 'The model was found in the local cache but the provider rejected it. The model may have been removed or is temporarily unavailable.',
                    providerID: input.providerID,
                    modelID: input.model.id,
                    statusCode: error.data.statusCode,
                    responseBody: error.data.responseBody,
                    suggestion:
                      'Try a different model or check the provider status. Use --model <provider>/<model-id> to specify an alternative.',
                    issue: 'https://github.com/link-assistant/agent/issues/208',
                  }));
                }
              }

              input.assistantMessage.error = error;
              Bus.publish(Session.Event.Error, {
                sessionID: input.assistantMessage.sessionID,
                error: input.assistantMessage.error,
              });
            }
          }
          const end = Date.now();
          if (currentText && currentText.time?.end === undefined) {
            currentText.text = currentText.text.trimEnd();
            currentText.time = { start: currentText.time?.start ?? end, end };
            await Session.updatePart(currentText);
          }
          for (const part of Object.values(reasoningMap)) {
            part.text = part.text.trimEnd();
            part.time = { start: part.time.start ?? end, end };
            await Session.updatePart(part);
          }
          const p = await MessageV2.parts(input.assistantMessage.id);
          for (const part of p) {
            if (
              part.type === 'tool' &&
              part.state.status !== 'completed' &&
              part.state.status !== 'error'
            ) {
              // Keep the real start and flag the part so the loop does not
              // treat an aborted call as one to continue from (upstream
              // #16776).
              await Session.updatePart({
                ...part,
                state: {
                  ...part.state,
                  status: 'error',
                  error: 'Tool execution aborted',
                  metadata: {
                    ...(part.state.status === 'running'
                      ? part.state.metadata
                      : undefined),
                    interrupted: true,
                  },
                  time: {
                    start:
                      part.state.status === 'running'
                        ? part.state.time.start
                        : end,
                    end,
                  },
                },
              });
            }
          }
          input.assistantMessage.time.completed = Date.now();
          await Session.updateMessage(input.assistantMessage);
          if (blocked) return 'stop';
          if (needsCompaction) return 'compact';
          if (input.assistantMessage.error) return 'stop';
          return 'continue';
        }
      },
    };
    return result;
  }
}
