import {
  isFreeTierError,
  FREE_TIER_ERROR_MESSAGE,
} from '../provider/free-tier-error';
import z from 'zod';
import { Bus } from '../bus';
import { NamedError } from '../util/error';
import { Message } from './message';
import {
  APICallError,
  convertToModelMessages,
  LoadAPIKeyError,
  type ModelMessage,
  type UIMessage,
} from 'ai';
import { Identifier } from '../id/id';
import { Snapshot } from '../snapshot';
import { fn } from '../util/fn';
import { Storage } from '../storage/storage';
import { isUnreachableNetworkError } from '../util/network-error';
import { STATUS_CODES } from 'node:http';

export namespace MessageV2 {
  export const OutputLengthError = NamedError.create(
    'MessageOutputLengthError',
    z.object({})
  );
  export const AbortedError = NamedError.create(
    'MessageAbortedError',
    z.object({ message: z.string() })
  );
  export const AuthError = NamedError.create(
    'ProviderAuthError',
    z.object({
      providerID: z.string(),
      message: z.string(),
    })
  );
  export const APIError = NamedError.create(
    'APIError',
    z.object({
      message: z.string(),
      statusCode: z.number().optional(),
      isRetryable: z.boolean(),
      responseHeaders: z.record(z.string(), z.string()).optional(),
      responseBody: z.string().optional(),
    })
  );
  export type APIError = z.infer<typeof APIError.Schema>;

  /**
   * Socket connection error - typically caused by Bun's 10-second idle timeout
   * in Bun.serve() context. These errors are transient and should be retried.
   * See: https://github.com/oven-sh/bun/issues/14439
   */
  export const SocketConnectionError = NamedError.create(
    'SocketConnectionError',
    z.object({
      message: z.string(),
      isRetryable: z.literal(true),
    })
  );
  export type SocketConnectionError = z.infer<
    typeof SocketConnectionError.Schema
  >;

  /**
   * Timeout error - caused by AbortSignal.timeout() firing when an API request
   * takes too long. These are DOMException with name === 'TimeoutError'.
   * These errors are transient and should be retried with increasing intervals.
   * See: https://github.com/link-assistant/agent/issues/142
   */
  export const TimeoutError = NamedError.create(
    'TimeoutError',
    z.object({
      message: z.string(),
      isRetryable: z.literal(true),
    })
  );
  export type TimeoutError = z.infer<typeof TimeoutError.Schema>;

  /**
   * The request exceeds the model's context window. Not retried as is: the
   * session is compacted and the turn continues (upstream #14707).
   */
  export const ContextOverflowError = NamedError.create(
    'ContextOverflowError',
    z.object({
      message: z.string(),
      responseBody: z.string().optional(),
    })
  );
  export type ContextOverflowError = z.infer<
    typeof ContextOverflowError.Schema
  >;

  // Provider wordings for "prompt exceeds the context window", from upstream
  // packages/ai/src/provider-error.ts.
  const OVERFLOW_PATTERNS = [
    /prompt is too long/i,
    /input is too long for (?:the )?(?:requested|selected) model/i,
    /too large for the model'?s configured input limit/i,
    /exceeded this model context window limit/i,
    /exceeds the context window/i,
    /exceeds (?:the )?(?:model'?s )?maximum context length(?: of [\d,]+ tokens?|\s*\([\d,]+\))/i,
    /input token count.*exceeds the maximum/i,
    /number of input tokens exceeds maximum length/i,
    /tokens in request more than max tokens allowed/i,
    /maximum prompt length is \d+/i,
    /reduce the length of the messages/i,
    /requested input length \d+ exceeds maximum input length/i,
    /maximum context length is \d+ tokens/i,
    /exceeds (?:the )?maximum allowed input length of [\d,]+ tokens?/i,
    /input(?: \(\d+ tokens\))? is longer than the model'?s context length/i,
    /exceeds the limit of \d+/i,
    /exceeds the available context size/i,
    /greater than the context length/i,
    /`inputs` tokens \+ `max_new_tokens` must be <= \d+/i,
    /context window exceeds limit/i,
    /exceeded model token limit/i,
    /context[_ ]length[_ ]exceeded/i,
    /context length is only \d+ tokens/i,
    /input length.*exceeds.*context length/i,
    /prompt (?:too long|exceeds max length|超长)/i,
    /too large for model with \d+ maximum context length/i,
    /prompt has [\d,]+ tokens?, but the configured context size is [\d,]+ tokens?/i,
    /model_context_window_exceeded/i,
    /range of input length should be/i,
    /too many tokens/i,
    /token limit exceeded/i,
    /request_too_large/i,
    /request entity too large/i,
    /payload too large/i,
    /request too large/i,
  ];
  // Rate limits also talk about "too many tokens"; they are not overflow.
  const OVERFLOW_EXCLUDE_PATTERNS = [
    /^(throttling error|service unavailable):/i,
    /rate limit/i,
    /too many requests/i,
    /max[_ ]tokens must be less than/i,
  ];

  export function isContextOverflow(message: string | undefined) {
    if (!message) return false;
    if (OVERFLOW_EXCLUDE_PATTERNS.some((pattern) => pattern.test(message)))
      return false;
    return (
      OVERFLOW_PATTERNS.some((pattern) => pattern.test(message)) ||
      /^4(?:00|13)\s*(status code)?\s*\(no body\)/i.test(message)
    );
  }

  const PartBase = z.object({
    id: z.string(),
    sessionID: z.string(),
    messageID: z.string(),
  });

  export const SnapshotPart = PartBase.extend({
    type: z.literal('snapshot'),
    snapshot: z.string(),
  }).meta({
    ref: 'SnapshotPart',
  });
  export type SnapshotPart = z.infer<typeof SnapshotPart>;

  export const PatchPart = PartBase.extend({
    type: z.literal('patch'),
    hash: z.string(),
    files: z.string().array(),
  }).meta({
    ref: 'PatchPart',
  });
  export type PatchPart = z.infer<typeof PatchPart>;

  export const TextPart = PartBase.extend({
    type: z.literal('text'),
    text: z.string(),
    synthetic: z.boolean().optional(),
    time: z
      .object({
        start: z.number(),
        end: z.number().optional(),
      })
      .optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  }).meta({
    ref: 'TextPart',
  });
  export type TextPart = z.infer<typeof TextPart>;

  export const ReasoningPart = PartBase.extend({
    type: z.literal('reasoning'),
    text: z.string(),
    metadata: z.record(z.string(), z.any()).optional(),
    time: z.object({
      start: z.number(),
      end: z.number().optional(),
    }),
  }).meta({
    ref: 'ReasoningPart',
  });
  export type ReasoningPart = z.infer<typeof ReasoningPart>;

  const FilePartSourceBase = z.object({
    text: z
      .object({
        value: z.string(),
        start: z.number().int(),
        end: z.number().int(),
      })
      .meta({
        ref: 'FilePartSourceText',
      }),
  });

  export const FileSource = FilePartSourceBase.extend({
    type: z.literal('file'),
    path: z.string(),
  }).meta({
    ref: 'FileSource',
  });

  export const SymbolSource = FilePartSourceBase.extend({
    type: z.literal('symbol'),
    path: z.string(),
    range: z.object({
      start: z.object({ line: z.number(), character: z.number() }),
      end: z.object({ line: z.number(), character: z.number() }),
    }),
    name: z.string(),
    kind: z.number().int(),
  }).meta({
    ref: 'SymbolSource',
  });

  export const FilePartSource = z
    .discriminatedUnion('type', [FileSource, SymbolSource])
    .meta({
      ref: 'FilePartSource',
    });

  export const FilePart = PartBase.extend({
    type: z.literal('file'),
    mime: z.string(),
    filename: z.string().optional(),
    url: z.string(),
    source: FilePartSource.optional(),
  }).meta({
    ref: 'FilePart',
  });
  export type FilePart = z.infer<typeof FilePart>;

  export const AgentPart = PartBase.extend({
    type: z.literal('agent'),
    name: z.string(),
    source: z
      .object({
        value: z.string(),
        start: z.number().int(),
        end: z.number().int(),
      })
      .optional(),
  }).meta({
    ref: 'AgentPart',
  });
  export type AgentPart = z.infer<typeof AgentPart>;

  export const CompactionPart = PartBase.extend({
    type: z.literal('compaction'),
  }).meta({
    ref: 'CompactionPart',
  });
  export type CompactionPart = z.infer<typeof CompactionPart>;

  export const SubtaskPart = PartBase.extend({
    type: z.literal('subtask'),
    prompt: z.string(),
    description: z.string(),
    agent: z.string(),
  });
  export type SubtaskPart = z.infer<typeof SubtaskPart>;

  export const RetryPart = PartBase.extend({
    type: z.literal('retry'),
    attempt: z.number(),
    error: APIError.Schema,
    time: z.object({
      created: z.number(),
    }),
  }).meta({
    ref: 'RetryPart',
  });
  export type RetryPart = z.infer<typeof RetryPart>;

  export const StepStartPart = PartBase.extend({
    type: z.literal('step-start'),
    snapshot: z.string().optional(),
  }).meta({
    ref: 'StepStartPart',
  });
  export type StepStartPart = z.infer<typeof StepStartPart>;

  /**
   * Model information for output parts.
   * Included when --output-response-model flag is enabled.
   * @see https://github.com/link-assistant/agent/issues/179
   */
  export const ModelInfo = z
    .object({
      providerID: z.string(),
      requestedModelID: z.string(),
      respondedModelID: z.string().optional(),
    })
    .meta({
      ref: 'ModelInfo',
    });
  export type ModelInfo = z.infer<typeof ModelInfo>;

  /**
   * Context diagnostic info for step-finish parts.
   * Shows model context limits and current usage to help debug compaction decisions.
   * @see https://github.com/link-assistant/agent/issues/217
   */
  export const ContextDiagnostics = z
    .object({
      contextLimit: z.number(),
      outputLimit: z.number(),
      usableContext: z.number(),
      safeLimit: z.number(),
      safetyMargin: z.number(),
      currentTokens: z.number(),
      headroom: z.number(),
      overflow: z.boolean(),
    })
    .meta({
      ref: 'ContextDiagnostics',
    });
  export type ContextDiagnostics = z.infer<typeof ContextDiagnostics>;

  export const StepFinishPart = PartBase.extend({
    type: z.literal('step-finish'),
    reason: z.string(),
    snapshot: z.string().optional(),
    cost: z.number(),
    tokens: z.object({
      input: z.number(),
      output: z.number(),
      reasoning: z.number(),
      cache: z.object({
        read: z.number(),
        write: z.number(),
      }),
    }),
    // Model info included when --output-response-model is enabled
    // @see https://github.com/link-assistant/agent/issues/179
    model: ModelInfo.optional(),
    // Context diagnostics for debugging compaction decisions
    // @see https://github.com/link-assistant/agent/issues/217
    context: ContextDiagnostics.optional(),
  }).meta({
    ref: 'StepFinishPart',
  });
  export type StepFinishPart = z.infer<typeof StepFinishPart>;

  export const ToolStatePending = z
    .object({
      status: z.literal('pending'),
      input: z.record(z.string(), z.any()),
      raw: z.string(),
    })
    .meta({
      ref: 'ToolStatePending',
    });

  export type ToolStatePending = z.infer<typeof ToolStatePending>;

  export const ToolStateRunning = z
    .object({
      status: z.literal('running'),
      input: z.record(z.string(), z.any()),
      title: z.string().optional(),
      metadata: z.record(z.string(), z.any()).optional(),
      time: z.object({
        start: z.number(),
      }),
    })
    .meta({
      ref: 'ToolStateRunning',
    });
  export type ToolStateRunning = z.infer<typeof ToolStateRunning>;

  export const ToolStateCompleted = z
    .object({
      status: z.literal('completed'),
      input: z.record(z.string(), z.any()),
      output: z.string(),
      title: z.string(),
      metadata: z.record(z.string(), z.any()),
      time: z.object({
        start: z.number(),
        end: z.number(),
        compacted: z.number().optional(),
      }),
      attachments: FilePart.array().optional(),
    })
    .meta({
      ref: 'ToolStateCompleted',
    });
  export type ToolStateCompleted = z.infer<typeof ToolStateCompleted>;

  export const ToolStateError = z
    .object({
      status: z.literal('error'),
      input: z.record(z.string(), z.any()),
      error: z.string(),
      title: z.string().optional(),
      attachments: FilePart.array().optional(),
      metadata: z.record(z.string(), z.any()).optional(),
      time: z.object({
        start: z.number(),
        end: z.number(),
      }),
    })
    .meta({
      ref: 'ToolStateError',
    });
  export type ToolStateError = z.infer<typeof ToolStateError>;

  export const ToolState = z
    .discriminatedUnion('status', [
      ToolStatePending,
      ToolStateRunning,
      ToolStateCompleted,
      ToolStateError,
    ])
    .meta({
      ref: 'ToolState',
    });

  export const ToolPart = PartBase.extend({
    type: z.literal('tool'),
    callID: z.string(),
    tool: z.string(),
    state: ToolState,
    metadata: z.record(z.string(), z.any()).optional(),
  }).meta({
    ref: 'ToolPart',
  });
  export type ToolPart = z.infer<typeof ToolPart>;

  const Base = z.object({
    id: z.string(),
    sessionID: z.string(),
  });

  export const User = Base.extend({
    role: z.literal('user'),
    time: z.object({
      created: z.number(),
    }),
    summary: z
      .object({
        title: z.string().optional(),
        body: z.string().optional(),
        diffs: Snapshot.FileDiff.array(),
      })
      .optional(),
    agent: z.string(),
    model: z.object({
      providerID: z.string(),
      modelID: z.string(),
    }),
    compactionModel: z
      .object({
        providerID: z.string(),
        modelID: z.string(),
        useSameModel: z.boolean(),
        compactionSafetyMarginPercent: z.number(),
        compactionModels: z
          .array(
            z.object({
              providerID: z.string(),
              modelID: z.string(),
              useSameModel: z.boolean(),
            })
          )
          .optional(),
      })
      .optional(),
    system: z.string().optional(),
    appendSystem: z.string().optional(),
    temperature: z.number().optional(),
    tools: z.record(z.string(), z.boolean()).optional(),
  }).meta({
    ref: 'UserMessage',
  });
  export type User = z.infer<typeof User>;

  export const Part = z
    .discriminatedUnion('type', [
      TextPart,
      SubtaskPart,
      ReasoningPart,
      FilePart,
      ToolPart,
      StepStartPart,
      StepFinishPart,
      SnapshotPart,
      PatchPart,
      AgentPart,
      RetryPart,
      CompactionPart,
    ])
    .meta({
      ref: 'Part',
    });
  export type Part = z.infer<typeof Part>;

  export const Assistant = Base.extend({
    role: z.literal('assistant'),
    time: z.object({
      created: z.number(),
      completed: z.number().optional(),
    }),
    error: z
      .discriminatedUnion('name', [
        AuthError.Schema,
        NamedError.Unknown.Schema,
        OutputLengthError.Schema,
        AbortedError.Schema,
        APIError.Schema,
        ContextOverflowError.Schema,
      ])
      .optional(),
    parentID: z.string(),
    modelID: z.string(),
    providerID: z.string(),
    mode: z.string(),
    path: z.object({
      cwd: z.string(),
      root: z.string(),
    }),
    summary: z.boolean().optional(),
    cost: z.number(),
    tokens: z.object({
      input: z.number(),
      output: z.number(),
      reasoning: z.number(),
      cache: z.object({
        read: z.number(),
        write: z.number(),
      }),
    }),
    finish: z.string().optional(),
  }).meta({
    ref: 'AssistantMessage',
  });
  export type Assistant = z.infer<typeof Assistant>;

  export const Info = z.discriminatedUnion('role', [User, Assistant]).meta({
    ref: 'Message',
  });
  export type Info = z.infer<typeof Info>;

  export const Event = {
    Updated: Bus.event(
      'message.updated',
      z.object({
        info: Info,
      })
    ),
    Removed: Bus.event(
      'message.removed',
      z.object({
        sessionID: z.string(),
        messageID: z.string(),
      })
    ),
    PartUpdated: Bus.event(
      'message.part.updated',
      z.object({
        part: Part,
        delta: z.string().optional(),
      })
    ),
    PartRemoved: Bus.event(
      'message.part.removed',
      z.object({
        sessionID: z.string(),
        messageID: z.string(),
        partID: z.string(),
      })
    ),
  };

  export const WithParts = z.object({
    info: Info,
    parts: z.array(Part),
  });
  export type WithParts = z.infer<typeof WithParts>;

  export function fromV1(v1: Message.Info) {
    if (v1.role === 'assistant') {
      const info: Assistant = {
        id: v1.id,
        parentID: '',
        sessionID: v1.metadata.sessionID,
        role: 'assistant',
        time: {
          created: v1.metadata.time.created,
          completed: v1.metadata.time.completed,
        },
        cost: v1.metadata.assistant!.cost,
        path: v1.metadata.assistant!.path,
        summary: v1.metadata.assistant!.summary,
        tokens: v1.metadata.assistant!.tokens,
        modelID: v1.metadata.assistant!.modelID,
        providerID: v1.metadata.assistant!.providerID,
        mode: 'build',
        error: v1.metadata.error,
      };
      const parts = v1.parts.flatMap((part): Part[] => {
        const base = {
          id: Identifier.ascending('part'),
          messageID: v1.id,
          sessionID: v1.metadata.sessionID,
        };
        if (part.type === 'text') {
          return [
            {
              ...base,
              type: 'text',
              text: part.text,
            },
          ];
        }
        if (part.type === 'step-start') {
          return [
            {
              ...base,
              type: 'step-start',
            },
          ];
        }
        if (part.type === 'tool-invocation') {
          return [
            {
              ...base,
              type: 'tool',
              callID: part.toolInvocation.toolCallId,
              tool: part.toolInvocation.toolName,
              state: (() => {
                if (part.toolInvocation.state === 'partial-call') {
                  return {
                    status: 'pending',
                    input: {},
                    raw: '',
                  };
                }

                const { title, time, ...metadata } =
                  v1.metadata.tool[part.toolInvocation.toolCallId] ?? {};
                if (part.toolInvocation.state === 'call') {
                  return {
                    status: 'running',
                    input: part.toolInvocation.args,
                    time: {
                      start: time?.start,
                    },
                  };
                }

                if (part.toolInvocation.state === 'result') {
                  return {
                    status: 'completed',
                    input: part.toolInvocation.args,
                    output: part.toolInvocation.result,
                    title,
                    time,
                    metadata,
                  };
                }
                throw new Error('unknown tool invocation state');
              })(),
            },
          ];
        }
        return [];
      });
      return {
        info,
        parts,
      };
    }

    if (v1.role === 'user') {
      const info: User = {
        id: v1.id,
        sessionID: v1.metadata.sessionID,
        role: 'user',
        time: {
          created: v1.metadata.time.created,
        },
        agent: 'build',
        model: {
          providerID: 'opencode',
          modelID: 'opencode',
        },
      };
      const parts = v1.parts.flatMap((part): Part[] => {
        const base = {
          id: Identifier.ascending('part'),
          messageID: v1.id,
          sessionID: v1.metadata.sessionID,
        };
        if (part.type === 'text') {
          return [
            {
              ...base,
              type: 'text',
              text: part.text,
            },
          ];
        }
        if (part.type === 'file') {
          return [
            {
              ...base,
              type: 'file',
              mime: part.mediaType,
              filename: part.filename,
              url: part.url,
            },
          ];
        }
        return [];
      });
      return { info, parts };
    }

    throw new Error('unknown message type');
  }

  /**
   * @param target the model the messages are sent to. Assistant turns from a
   * different model drop their provider metadata and replay reasoning as text,
   * because signatures and item ids are only valid for the model that produced
   * them (upstream 021e42c0bb1).
   */
  export async function toModelMessage(
    input: {
      info: Info;
      parts: Part[];
    }[],
    target?: { providerID: string; modelID: string }
  ): Promise<ModelMessage[]> {
    const result: UIMessage[] = [];

    for (const msg of input) {
      if (msg.parts.length === 0) continue;

      if (msg.info.role === 'user') {
        const userMessage: UIMessage = {
          id: msg.info.id,
          role: 'user',
          parts: [],
        };
        result.push(userMessage);
        for (const part of msg.parts) {
          if (part.type === 'text')
            userMessage.parts.push({
              type: 'text',
              text: part.text,
            });
          // text/plain and directory files are converted into text parts, ignore them
          if (
            part.type === 'file' &&
            part.mime !== 'text/plain' &&
            part.mime !== 'application/x-directory'
          )
            userMessage.parts.push({
              type: 'file',
              url: part.url,
              mediaType: part.mime,
              filename: part.filename,
            });

          if (part.type === 'compaction') {
            userMessage.parts.push({
              type: 'text',
              text: 'What did we do so far?',
            });
          }
          if (part.type === 'subtask') {
            userMessage.parts.push({
              type: 'text',
              text: 'The following tool was executed by the user',
            });
          }
        }
      }

      if (msg.info.role === 'assistant') {
        const assistantMessage: UIMessage = {
          id: msg.info.id,
          role: 'assistant',
          parts: [],
        };
        result.push(assistantMessage);
        const differentModel =
          target !== undefined &&
          (target.providerID !== msg.info.providerID ||
            target.modelID !== msg.info.modelID);
        const metadata = <T>(value: T) => (differentModel ? undefined : value);
        // Anthropic needs the empty separator between signed thinking blocks
        // kept, so send ' ' rather than '' (upstream #21370).
        const hasSignedReasoning = msg.parts.some(
          (part) =>
            part.type === 'reasoning' &&
            part.metadata?.anthropic?.signature != null
        );
        for (const part of msg.parts) {
          if (part.type === 'text')
            assistantMessage.parts.push({
              type: 'text',
              text: part.text === '' && hasSignedReasoning ? ' ' : part.text,
              providerMetadata: metadata(part.metadata),
            });
          if (part.type === 'step-start')
            assistantMessage.parts.push({
              type: 'step-start',
            });
          if (part.type === 'tool') {
            if (
              part.state.status === 'completed' ||
              part.state.status === 'error'
            ) {
              if (part.state.attachments?.length) {
                result.push({
                  id: Identifier.ascending('message'),
                  role: 'user',
                  parts: [
                    {
                      type: 'text',
                      text: `Tool ${part.tool} returned an attachment:`,
                    },
                    ...part.state.attachments.map((attachment) => ({
                      type: 'file' as const,
                      url: attachment.url,
                      mediaType: attachment.mime,
                      filename: attachment.filename,
                    })),
                  ],
                });
              }
            }
            if (part.state.status === 'completed') {
              assistantMessage.parts.push({
                type: ('tool-' + part.tool) as `tool-${string}`,
                state: 'output-available',
                toolCallId: part.callID,
                input: part.state.input,
                output: part.state.time.compacted
                  ? '[Old tool result content cleared]'
                  : part.state.output,
                callProviderMetadata: metadata(part.metadata),
              });
            }
            if (part.state.status === 'error')
              assistantMessage.parts.push({
                type: ('tool-' + part.tool) as `tool-${string}`,
                state: 'output-error',
                toolCallId: part.callID,
                input: part.state.input,
                errorText: part.state.error,
                callProviderMetadata: metadata(part.metadata),
              });
          }
          if (part.type === 'reasoning') {
            if (differentModel) {
              if (part.text.trim().length > 0)
                assistantMessage.parts.push({ type: 'text', text: part.text });
              continue;
            }
            assistantMessage.parts.push({
              type: 'reasoning',
              text: part.text,
              providerMetadata: part.metadata,
            });
          }
        }
      }
    }

    // A message whose parts all convert to nothing would become
    // `content: []`, which Anthropic and Bedrock reject (upstream #4811).
    return await convertToModelMessages(
      result.filter((msg) =>
        msg.parts.some((part) => part.type !== 'step-start')
      )
    );
  }

  export const stream = fn(
    Identifier.schema('session'),
    async function* (sessionID) {
      const list = await Array.fromAsync(
        await Storage.list(['message', sessionID])
      );
      for (let i = list.length - 1; i >= 0; i--) {
        yield await get({
          sessionID,
          messageID: list[i][2],
        });
      }
    }
  );

  export const parts = fn(Identifier.schema('message'), async (messageID) => {
    const result = [] as MessageV2.Part[];
    for (const item of await Storage.list(['part', messageID])) {
      const read = await Storage.read<MessageV2.Part>(item);
      result.push(read);
    }
    result.sort((a, b) => (a.id > b.id ? 1 : -1));
    return result;
  });

  export const get = fn(
    z.object({
      sessionID: Identifier.schema('session'),
      messageID: Identifier.schema('message'),
    }),
    async (input) => {
      return {
        info: await Storage.read<MessageV2.Info>([
          'message',
          input.sessionID,
          input.messageID,
        ]),
        parts: await parts(input.messageID),
      };
    }
  );

  export async function filterCompacted(
    stream: AsyncIterable<MessageV2.WithParts>
  ) {
    const result = [] as MessageV2.WithParts[];
    const completed = new Set<string>();
    for await (const msg of stream) {
      result.push(msg);
      if (
        msg.info.role === 'user' &&
        completed.has(msg.info.id) &&
        msg.parts.some((part) => part.type === 'compaction')
      )
        break;
      if (msg.info.role === 'assistant' && msg.info.summary && msg.info.finish)
        completed.add(msg.info.parentID);
    }
    result.reverse();
    return result;
  }

  // Stream-error codes whose retryability the HTTP status gets wrong
  // (upstream #23069).
  const NON_RETRYABLE_PROVIDER_CODES = new Set([
    'insufficient_quota',
    'usage_not_included',
    'invalid_prompt',
  ]);
  const RETRYABLE_PROVIDER_CODES = new Set([
    'server_error',
    'server_is_overloaded',
    'overloaded_error',
    'api_error',
    'rate_limit_error',
  ]);

  function parseJsonObject(input: unknown) {
    if (typeof input !== 'string') return;
    try {
      const parsed = JSON.parse(input);
      if (parsed && typeof parsed === 'object')
        return parsed as Record<string, any>;
    } catch {}
  }

  function normalizeProviderErrorObject(e: unknown) {
    if (!e || typeof e !== 'object') return;

    const root = e as Record<string, unknown>;
    const candidate =
      root['error'] && typeof root['error'] === 'object'
        ? (root['error'] as Record<string, unknown>)
        : root;
    // A numeric status must win over a string `code` such as "server_error",
    // otherwise the object is not recognised at all (upstream #23069).
    const statusCode = [
      candidate['statusCode'],
      candidate['status'],
      root['statusCode'],
      root['status'],
      candidate['code'],
      root['code'],
    ]
      .map((value) =>
        typeof value === 'number'
          ? value
          : typeof value === 'string' && /^\d+$/.test(value)
            ? Number.parseInt(value, 10)
            : undefined
      )
      .find((value) => value !== undefined);
    const code = [
      candidate['code'],
      root['code'],
      candidate['type'],
      root['type'],
    ].find(
      (value): value is string =>
        typeof value === 'string' && value !== 'error' && !/^\d+$/.test(value)
    );

    if (statusCode === undefined && (code === undefined || e instanceof Error))
      return;

    let responseBody: string | undefined;
    try {
      responseBody = JSON.stringify(e);
    } catch {
      responseBody = undefined;
    }

    const message =
      typeof candidate['message'] === 'string'
        ? candidate['message']
        : typeof root['message'] === 'string'
          ? root['message']
          : statusCode !== undefined
            ? `Provider returned HTTP ${statusCode}`
            : code!;

    if (code === 'context_length_exceeded' || isContextOverflow(message)) {
      return { overflow: true as const, message, statusCode, responseBody };
    }

    const sdkRetryable = [root['isRetryable'], candidate['isRetryable']].find(
      (value): value is boolean => typeof value === 'boolean'
    );
    const isRetryable =
      code && NON_RETRYABLE_PROVIDER_CODES.has(code)
        ? false
        : code && RETRYABLE_PROVIDER_CODES.has(code)
          ? true
          : (sdkRetryable ??
            (statusCode === 429 ||
              (statusCode !== undefined && statusCode >= 500)));

    return {
      overflow: false as const,
      message,
      statusCode,
      isRetryable,
      responseBody,
    };
  }

  // Adds the provider's explanation to a bare status text and keeps HTML
  // gateway pages out of the message (upstream #13530, #14096).
  function apiErrorMessage(e: APICallError) {
    const message = e.message;
    const body = e.responseBody;
    const statusText = e.statusCode ? STATUS_CODES[e.statusCode] : undefined;
    if (message === '') return (body || statusText || 'Unknown error').trim();
    if (!body || (statusText && message !== statusText)) return message;

    const json = parseJsonObject(body);
    if (json) {
      const detail = [json.message, json.error?.message, json.error].find(
        (value): value is string => typeof value === 'string' && value !== ''
      );
      if (detail) return `${message}: ${detail}`.trim();
    }

    if (/^\s*<!doctype|^\s*<html/i.test(body)) {
      if (e.statusCode === 401)
        return 'Unauthorized: request was blocked by a gateway or proxy. Your authentication token may be missing or expired - try `agent auth login` to re-authenticate.';
      if (e.statusCode === 403)
        return 'Forbidden: request was blocked by a gateway or proxy. You may not have permission to access this resource - check your account and provider settings.';
      return message;
    }

    return `${message}: ${body}`.trim();
  }

  // Plain errors that are really rate limits or overload (upstream retry.ts).
  function isRateLimitMessage(message: string) {
    const lower = message.toLowerCase();
    if (
      lower.includes('rate increased too quickly') ||
      lower.includes('rate limit') ||
      lower.includes('too many requests')
    )
      return true;
    const json = parseJsonObject(message);
    if (!json) return false;
    const code = typeof json.code === 'string' ? json.code.toLowerCase() : '';
    if (json.type === 'error' && json.error?.type === 'too_many_requests')
      return true;
    if (code.includes('exhausted') || code.includes('unavailable')) return true;
    return (
      json.type === 'error' &&
      typeof json.error?.code === 'string' &&
      json.error.code.includes('rate_limit')
    );
  }

  export function fromError(e: unknown, ctx: { providerID: string }) {
    const providerError = APICallError.isInstance(e)
      ? undefined
      : normalizeProviderErrorObject(e);
    const freeTierRefusal =
      ctx.providerID === 'opencode' &&
      (APICallError.isInstance(e)
        ? isFreeTierError(e.statusCode, e.responseBody)
        : isFreeTierError(providerError?.statusCode, e));
    if (freeTierRefusal) {
      return new MessageV2.APIError(
        {
          message: FREE_TIER_ERROR_MESSAGE,
          statusCode: 403,
          isRetryable: false,
          responseBody: APICallError.isInstance(e)
            ? e.responseBody
            : providerError?.responseBody,
        },
        { cause: e }
      ).toObject();
    }
    switch (true) {
      case e instanceof DOMException && e.name === 'AbortError':
        return new MessageV2.AbortedError(
          { message: e.message },
          {
            cause: e,
          }
        ).toObject();
      case e instanceof DOMException && e.name === 'TimeoutError':
        return new MessageV2.TimeoutError(
          { message: e.message, isRetryable: true },
          { cause: e }
        ).toObject();
      case MessageV2.OutputLengthError.isInstance(e):
        return e;
      case LoadAPIKeyError.isInstance(e):
        return new MessageV2.AuthError(
          {
            providerID: ctx.providerID,
            message: e.message,
          },
          { cause: e }
        ).toObject();
      case APICallError.isInstance(e): {
        const message = apiErrorMessage(e);
        const body = parseJsonObject(e.responseBody);
        if (
          isContextOverflow(message) ||
          e.statusCode === 413 ||
          body?.error?.code === 'context_length_exceeded'
        ) {
          return new MessageV2.ContextOverflowError(
            { message, responseBody: e.responseBody },
            { cause: e }
          ).toObject();
        }
        const status = e.statusCode;
        return new MessageV2.APIError(
          {
            message,
            statusCode: status,
            // A refused connection / unresolvable host is not transient: the
            // AI SDK marks it retryable, but retrying it for the 7-day global
            // budget makes the CLI hang forever (#290). Any 5xx is transient
            // even when the SDK says otherwise (upstream #22508), and OpenAI
            // returns 404 for models that do exist (upstream #13579).
            isRetryable: isUnreachableNetworkError(e)
              ? false
              : e.isRetryable ||
                (status !== undefined && status >= 500) ||
                (ctx.providerID.startsWith('openai') && status === 404),
            responseHeaders: e.responseHeaders,
            responseBody: e.responseBody,
          },
          { cause: e }
        ).toObject();
      }
      case providerError !== undefined: {
        const normalized = providerError!;
        if (normalized.overflow === true) {
          return new MessageV2.ContextOverflowError(
            {
              message: normalized.message,
              responseBody: normalized.responseBody,
            },
            { cause: e }
          ).toObject();
        }
        const { overflow: _, ...data } = normalized;
        return new MessageV2.APIError(data, { cause: e }).toObject();
      }
      case e instanceof Error: {
        const message = e.message || e.toString();
        // Detect Bun socket connection errors (known Bun issue with 10s idle timeout)
        // See: https://github.com/oven-sh/bun/issues/14439
        const isSocketError =
          message.includes('socket connection was closed') ||
          message.includes('closed unexpectedly');
        if (isSocketError) {
          return new MessageV2.SocketConnectionError(
            { message, isRetryable: true },
            { cause: e }
          ).toObject();
        }
        // Detect timeout errors from various sources
        // See: https://github.com/link-assistant/agent/issues/142
        const isTimeoutError =
          message.includes('The operation timed out') ||
          message.includes('timed out') ||
          e.name === 'TimeoutError';
        if (isTimeoutError) {
          return new MessageV2.TimeoutError(
            { message, isRetryable: true },
            { cause: e }
          ).toObject();
        }
        // Bun throws ZlibError when a gzip body is cut off mid-transfer
        // (upstream #18064).
        if (
          e.name === 'ZlibError' ||
          String((e as { code?: unknown }).code ?? '').startsWith('Z_')
        ) {
          return new MessageV2.APIError(
            { message, isRetryable: true },
            { cause: e }
          ).toObject();
        }
        if (isContextOverflow(message)) {
          return new MessageV2.ContextOverflowError(
            { message },
            { cause: e }
          ).toObject();
        }
        if (isRateLimitMessage(message)) {
          return new MessageV2.APIError(
            { message, isRetryable: true },
            { cause: e }
          ).toObject();
        }
        return new NamedError.Unknown(
          { message: e.toString() },
          { cause: e }
        ).toObject();
      }
      default:
        return new NamedError.Unknown(
          { message: JSON.stringify(e) },
          { cause: e }
        );
    }
  }
}
