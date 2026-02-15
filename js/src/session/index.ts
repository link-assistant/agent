import { Decimal } from 'decimal.js';
import z from 'zod';
import { type LanguageModelUsage, type ProviderMetadata } from 'ai';
import { Bus } from '../bus';
import { Config } from '../config/config';
import { Flag } from '../flag/flag';
import { Identifier } from '../id/id';
import type { ModelsDev } from '../provider/models';
import { Storage } from '../storage/storage';
import { Log } from '../util/log';
import { MessageV2 } from './message-v2';
import { Instance } from '../project/instance';
import { SessionPrompt } from './prompt';
import { fn } from '../util/fn';
import { Command } from '../command';
import { Snapshot } from '../snapshot';

export namespace Session {
  const log = Log.create({ service: 'session' });

  /**
   * Safely converts a value to a Decimal instance.
   * Attempts to create a Decimal from the input value (supports numbers, strings, etc.)
   * and returns Decimal(NaN) only if the Decimal constructor throws an error.
   *
   * Logs input data in verbose mode at all stages to help identify data issues.
   *
   * This is necessary because AI providers may return unexpected token usage data
   * that would crash the Decimal.js constructor with "[DecimalError] Invalid argument".
   *
   * @param value - The value to convert to Decimal (number, string, etc.)
   * @param context - Optional context string for debugging (e.g., "inputTokens")
   * @returns A Decimal instance, or Decimal(NaN) if the Decimal constructor fails
   * @see https://github.com/link-assistant/agent/issues/119
   */
  export const toDecimal = (value: unknown, context?: string): Decimal => {
    // Log input data in verbose mode to help identify issues
    if (Flag.OPENCODE_VERBOSE) {
      log.debug(() => ({
        message: 'toDecimal input',
        context,
        valueType: typeof value,
        value:
          typeof value === 'object' ? JSON.stringify(value) : String(value),
      }));
    }

    try {
      // Let Decimal handle the conversion - it supports numbers, strings, and more
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = new Decimal(value as any);

      // Log successful conversion in verbose mode
      if (Flag.OPENCODE_VERBOSE) {
        log.debug(() => ({
          message: 'toDecimal success',
          context,
          result: result.toString(),
        }));
      }

      return result;
    } catch (error) {
      // Log the error and return Decimal(NaN)
      if (Flag.OPENCODE_VERBOSE) {
        log.debug(() => ({
          message: 'toDecimal error - returning Decimal(NaN)',
          context,
          valueType: typeof value,
          value:
            typeof value === 'object' ? JSON.stringify(value) : String(value),
          error: error instanceof Error ? error.message : String(error),
        }));
      }
      return new Decimal(NaN);
    }
  };

  const parentTitlePrefix = 'New session - ';
  const childTitlePrefix = 'Child session - ';

  function createDefaultTitle(isChild = false) {
    return (
      (isChild ? childTitlePrefix : parentTitlePrefix) +
      new Date().toISOString()
    );
  }

  export function isDefaultTitle(title: string) {
    return new RegExp(
      `^(${parentTitlePrefix}|${childTitlePrefix})\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`
    ).test(title);
  }

  export const Info = z
    .object({
      id: Identifier.schema('session'),
      projectID: z.string(),
      directory: z.string(),
      parentID: Identifier.schema('session').optional(),
      summary: z
        .object({
          additions: z.number(),
          deletions: z.number(),
          files: z.number(),
          diffs: Snapshot.FileDiff.array().optional(),
        })
        .optional(),
      // share field removed - no sharing support
      title: z.string(),
      version: z.string(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
        compacting: z.number().optional(),
      }),
      revert: z
        .object({
          messageID: z.string(),
          partID: z.string().optional(),
          snapshot: z.string().optional(),
          diff: z.string().optional(),
        })
        .optional(),
    })
    .meta({
      ref: 'Session',
    });
  export type Info = z.output<typeof Info>;

  // ShareInfo removed - share not supported

  export const Event = {
    Created: Bus.event(
      'session.created',
      z.object({
        info: Info,
      })
    ),
    Updated: Bus.event(
      'session.updated',
      z.object({
        info: Info,
      })
    ),
    Deleted: Bus.event(
      'session.deleted',
      z.object({
        info: Info,
      })
    ),
    Diff: Bus.event(
      'session.diff',
      z.object({
        sessionID: z.string(),
        diff: Snapshot.FileDiff.array(),
      })
    ),
    Error: Bus.event(
      'session.error',
      z.object({
        sessionID: z.string().optional(),
        error: MessageV2.Assistant.shape.error,
      })
    ),
  };

  export const create = fn(
    z
      .object({
        parentID: Identifier.schema('session').optional(),
        title: z.string().optional(),
      })
      .optional(),
    async (input) => {
      return createNext({
        parentID: input?.parentID,
        directory: Instance.directory,
        title: input?.title,
      });
    }
  );

  export const fork = fn(
    z.object({
      sessionID: Identifier.schema('session'),
      messageID: Identifier.schema('message').optional(),
    }),
    async (input) => {
      const session = await createNext({
        directory: Instance.directory,
      });
      const msgs = await messages({ sessionID: input.sessionID });
      for (const msg of msgs) {
        if (input.messageID && msg.info.id >= input.messageID) break;
        const cloned = await updateMessage({
          ...msg.info,
          sessionID: session.id,
          id: Identifier.ascending('message'),
        });

        for (const part of msg.parts) {
          await updatePart({
            ...part,
            id: Identifier.ascending('part'),
            messageID: cloned.id,
            sessionID: session.id,
          });
        }
      }
      return session;
    }
  );

  export const touch = fn(Identifier.schema('session'), async (sessionID) => {
    await update(sessionID, (draft) => {
      draft.time.updated = Date.now();
    });
  });

  export async function createNext(input: {
    id?: string;
    title?: string;
    parentID?: string;
    directory: string;
  }) {
    const result: Info = {
      id: Identifier.descending('session', input.id),
      version: 'agent-cli-1.0.0',
      projectID: Instance.project.id,
      directory: input.directory,
      parentID: input.parentID,
      title: input.title ?? createDefaultTitle(!!input.parentID),
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
    };
    log.info(() => ({ message: 'created', ...result }));
    await Storage.write(['session', Instance.project.id, result.id], result);
    Bus.publish(Event.Created, {
      info: result,
    });
    // Share not supported - removed auto-sharing
    Bus.publish(Event.Updated, {
      info: result,
    });
    return result;
  }

  export const get = fn(Identifier.schema('session'), async (id) => {
    const read = await Storage.read<Info>(['session', Instance.project.id, id]);
    return read as Info;
  });

  // getShare, share, unshare removed - share not supported

  export async function update(id: string, editor: (session: Info) => void) {
    const project = Instance.project;
    const result = await Storage.update<Info>(
      ['session', project.id, id],
      (draft) => {
        editor(draft);
        draft.time.updated = Date.now();
      }
    );
    Bus.publish(Event.Updated, {
      info: result,
    });
    return result;
  }

  export const diff = fn(Identifier.schema('session'), async (sessionID) => {
    const diffs = await Storage.read<Snapshot.FileDiff[]>([
      'session_diff',
      sessionID,
    ]);
    return diffs ?? [];
  });

  export const messages = fn(
    z.object({
      sessionID: Identifier.schema('session'),
      limit: z.number().optional(),
    }),
    async (input) => {
      const result = [] as MessageV2.WithParts[];
      for await (const msg of MessageV2.stream(input.sessionID)) {
        if (input.limit && result.length >= input.limit) break;
        result.push(msg);
      }
      result.reverse();
      return result;
    }
  );

  export async function* list() {
    const project = Instance.project;
    for (const item of await Storage.list(['session', project.id])) {
      yield Storage.read<Info>(item);
    }
  }

  export const children = fn(Identifier.schema('session'), async (parentID) => {
    const project = Instance.project;
    const result = [] as Session.Info[];
    for (const item of await Storage.list(['session', project.id])) {
      const session = await Storage.read<Info>(item);
      if (session.parentID !== parentID) continue;
      result.push(session);
    }
    return result;
  });

  export const remove = fn(Identifier.schema('session'), async (sessionID) => {
    const project = Instance.project;
    try {
      const session = await get(sessionID);
      for (const child of await children(sessionID)) {
        await remove(child.id);
      }
      // unshare removed - share not supported
      for (const msg of await Storage.list(['message', sessionID])) {
        for (const part of await Storage.list(['part', msg.at(-1)!])) {
          await Storage.remove(part);
        }
        await Storage.remove(msg);
      }
      await Storage.remove(['session', project.id, sessionID]);
      Bus.publish(Event.Deleted, {
        info: session,
      });
    } catch (e) {
      log.error(() => ({ error: e }));
    }
  });

  export const updateMessage = fn(MessageV2.Info, async (msg) => {
    await Storage.write(['message', msg.sessionID, msg.id], msg);
    Bus.publish(MessageV2.Event.Updated, {
      info: msg,
    });
    return msg;
  });

  export const removeMessage = fn(
    z.object({
      sessionID: Identifier.schema('session'),
      messageID: Identifier.schema('message'),
    }),
    async (input) => {
      await Storage.remove(['message', input.sessionID, input.messageID]);
      Bus.publish(MessageV2.Event.Removed, {
        sessionID: input.sessionID,
        messageID: input.messageID,
      });
      return input.messageID;
    }
  );

  const UpdatePartInput = z.union([
    MessageV2.Part,
    z.object({
      part: MessageV2.TextPart,
      delta: z.string(),
    }),
    z.object({
      part: MessageV2.ReasoningPart,
      delta: z.string(),
    }),
  ]);

  export const updatePart = fn(UpdatePartInput, async (input) => {
    const part = 'delta' in input ? input.part : input;
    const delta = 'delta' in input ? input.delta : undefined;
    await Storage.write(['part', part.messageID, part.id], part);
    Bus.publish(MessageV2.Event.PartUpdated, {
      part,
      delta,
    });
    return part;
  });

  /**
   * Safely converts a value to a number.
   * Attempts to parse/convert the input value and returns NaN if conversion fails.
   *
   * Logs input data in verbose mode at all stages to help identify data issues.
   *
   * This is necessary because AI providers may return unexpected token usage data
   * that would cause issues if not handled properly.
   *
   * @param value - The value to convert to number (number, string, etc.)
   * @param context - Optional context string for debugging (e.g., "inputTokens")
   * @returns A number, or NaN if conversion fails
   * @see https://github.com/link-assistant/agent/issues/119
   */
  export const toNumber = (value: unknown, context?: string): number => {
    // Log input data in verbose mode to help identify issues
    if (Flag.OPENCODE_VERBOSE) {
      log.debug(() => ({
        message: 'toNumber input',
        context,
        valueType: typeof value,
        value:
          typeof value === 'object' ? JSON.stringify(value) : String(value),
      }));
    }

    try {
      // Handle undefined/null gracefully by returning 0
      // These are expected for optional fields like cachedInputTokens, reasoningTokens
      // See: https://github.com/link-assistant/agent/issues/127
      if (value === undefined || value === null) {
        if (Flag.OPENCODE_VERBOSE) {
          log.debug(() => ({
            message: 'toNumber received undefined/null, returning 0',
            context,
            valueType: typeof value,
          }));
        }
        return 0;
      }

      // Handle objects with a 'total' field (e.g., { total: 8707, noCache: 6339, cacheRead: 2368 })
      // Some AI providers return token counts as objects instead of plain numbers
      // See: https://github.com/link-assistant/agent/issues/125
      if (
        typeof value === 'object' &&
        value !== null &&
        'total' in value &&
        typeof (value as { total: unknown }).total === 'number'
      ) {
        const result = (value as { total: number }).total;
        if (Flag.OPENCODE_VERBOSE) {
          log.debug(() => ({
            message: 'toNumber extracted total from object',
            context,
            result,
          }));
        }
        return result;
      }

      // Try to convert to number
      const result = Number(value);

      // Check if conversion produced a valid result
      // Note: Number({}) returns NaN, Number([1]) returns 1, Number([1,2]) returns NaN
      if (Number.isNaN(result)) {
        throw new Error(`Conversion to number resulted in NaN`);
      }

      // Log successful conversion in verbose mode
      if (Flag.OPENCODE_VERBOSE) {
        log.debug(() => ({
          message: 'toNumber success',
          context,
          result,
        }));
      }

      return result;
    } catch (error) {
      // Log the error and return NaN
      if (Flag.OPENCODE_VERBOSE) {
        log.debug(() => ({
          message: 'toNumber error - returning NaN',
          context,
          valueType: typeof value,
          value:
            typeof value === 'object' ? JSON.stringify(value) : String(value),
          error: error instanceof Error ? error.message : String(error),
        }));
      }
      return NaN;
    }
  };

  /**
   * Safely converts a finishReason value to a string.
   * Some AI providers return finishReason as an object instead of a string.
   *
   * For example, OpenCode provider on certain Bun versions may return:
   * - { type: "stop" } instead of "stop"
   * - { finishReason: "tool-calls" } instead of "tool-calls"
   *
   * This function handles these cases gracefully.
   *
   * @param value - The finishReason value (string, object, or undefined)
   * @returns A string representing the finish reason, or 'unknown' if conversion fails
   * @see https://github.com/link-assistant/agent/issues/125
   */
  export const toFinishReason = (value: unknown): string => {
    // Log input data in verbose mode to help identify issues
    if (Flag.OPENCODE_VERBOSE) {
      log.debug(() => ({
        message: 'toFinishReason input',
        valueType: typeof value,
        value:
          typeof value === 'object' ? JSON.stringify(value) : String(value),
      }));
    }

    // If it's already a string, return it
    if (typeof value === 'string') {
      return value;
    }

    // If it's undefined or null, return 'unknown'
    if (value === undefined || value === null) {
      return 'unknown';
    }

    // If it's an object, try to extract a meaningful string
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;

      // Try common field names that might contain the reason
      if (typeof obj.type === 'string') {
        if (Flag.OPENCODE_VERBOSE) {
          log.debug(() => ({
            message: 'toFinishReason extracted type from object',
            result: obj.type,
          }));
        }
        return obj.type;
      }

      if (typeof obj.finishReason === 'string') {
        if (Flag.OPENCODE_VERBOSE) {
          log.debug(() => ({
            message: 'toFinishReason extracted finishReason from object',
            result: obj.finishReason,
          }));
        }
        return obj.finishReason;
      }

      if (typeof obj.reason === 'string') {
        if (Flag.OPENCODE_VERBOSE) {
          log.debug(() => ({
            message: 'toFinishReason extracted reason from object',
            result: obj.reason,
          }));
        }
        return obj.reason;
      }

      // Handle AI SDK unified/raw format: {unified: "tool-calls", raw: "tool_calls"}
      // See: https://github.com/link-assistant/agent/issues/129
      if (typeof obj.unified === 'string') {
        if (Flag.OPENCODE_VERBOSE) {
          log.debug(() => ({
            message: 'toFinishReason extracted unified from object',
            result: obj.unified,
          }));
        }
        return obj.unified;
      }

      // If we can't extract a specific field, return JSON representation
      if (Flag.OPENCODE_VERBOSE) {
        log.debug(() => ({
          message: 'toFinishReason could not extract string, using JSON',
          result: JSON.stringify(value),
        }));
      }
      return JSON.stringify(value);
    }

    // For any other type, convert to string
    return String(value);
  };

  export const getUsage = fn(
    z.object({
      model: z.custom<ModelsDev.Model>(),
      usage: z.custom<LanguageModelUsage>(),
      metadata: z.custom<ProviderMetadata>().optional(),
    }),
    (input) => {
      // Handle undefined or null usage gracefully
      // Some providers (e.g., OpenCode with Kimi K2.5) may return incomplete usage data
      // See: https://github.com/link-assistant/agent/issues/152
      if (!input.usage) {
        log.warn(() => ({
          message: 'getUsage received undefined usage, returning zero values',
          providerMetadata: input.metadata
            ? JSON.stringify(input.metadata)
            : 'none',
        }));
        return {
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        };
      }

      // Log raw usage data in verbose mode for debugging
      if (Flag.OPENCODE_VERBOSE) {
        log.debug(() => ({
          message: 'getUsage called with raw data',
          rawUsage: JSON.stringify(input.usage),
          rawMetadata: input.metadata ? JSON.stringify(input.metadata) : 'none',
        }));
      }

      // Helper: convert toNumber result to 0 if NaN or not finite (for safe calculations)
      const safeNum = (n: number): number =>
        Number.isNaN(n) || !Number.isFinite(n) ? 0 : n;

      // Check if standard usage has valid data (inputTokens or outputTokens defined)
      // If not, try to extract from providerMetadata.openrouter.usage
      // This handles cases where OpenRouter-compatible APIs (like Kilo) put usage in metadata
      // See: https://github.com/link-assistant/agent/issues/187
      const openrouterUsage = input.metadata?.['openrouter']?.['usage'] as
        | {
            promptTokens?: number;
            completionTokens?: number;
            totalTokens?: number;
            cost?: number;
            promptTokensDetails?: { cachedTokens?: number };
            completionTokensDetails?: { reasoningTokens?: number };
            costDetails?: { upstreamInferenceCost?: number };
          }
        | undefined;

      const standardUsageIsEmpty =
        input.usage.inputTokens === undefined &&
        input.usage.outputTokens === undefined;

      // If standard usage is empty but openrouter metadata has usage, use it as source
      let effectiveUsage = input.usage;
      if (standardUsageIsEmpty && openrouterUsage) {
        if (Flag.OPENCODE_VERBOSE) {
          log.debug(() => ({
            message:
              'Standard usage empty, falling back to openrouter metadata',
            openrouterUsage: JSON.stringify(openrouterUsage),
          }));
        }
        // Create a usage-like object from openrouter metadata
        // The openrouter usage uses camelCase: promptTokens, completionTokens
        effectiveUsage = {
          ...input.usage,
          inputTokens: openrouterUsage.promptTokens,
          outputTokens: openrouterUsage.completionTokens,
          totalTokens: openrouterUsage.totalTokens,
          cachedInputTokens:
            openrouterUsage.promptTokensDetails?.cachedTokens ?? 0,
          reasoningTokens:
            openrouterUsage.completionTokensDetails?.reasoningTokens ?? 0,
        };
      }

      // Extract top-level cachedInputTokens
      const topLevelCachedInputTokens = safeNum(
        toNumber(effectiveUsage.cachedInputTokens, 'cachedInputTokens')
      );

      // Some providers (e.g., opencode/grok-code) nest cacheRead inside inputTokens object
      // e.g., inputTokens: { total: 12703, noCache: 12511, cacheRead: 192 }
      // See: https://github.com/link-assistant/agent/issues/127
      const inputTokensObj = effectiveUsage.inputTokens;
      const nestedCacheRead =
        typeof inputTokensObj === 'object' && inputTokensObj !== null
          ? safeNum(
              toNumber(
                (inputTokensObj as { cacheRead?: unknown }).cacheRead,
                'inputTokens.cacheRead'
              )
            )
          : 0;

      // Use top-level if available, otherwise fall back to nested
      const cachedInputTokens = topLevelCachedInputTokens || nestedCacheRead;

      const excludesCachedTokens = !!(
        input.metadata?.['anthropic'] || input.metadata?.['bedrock']
      );

      const rawInputTokens = safeNum(
        toNumber(effectiveUsage.inputTokens, 'inputTokens')
      );
      const adjustedInputTokens = excludesCachedTokens
        ? rawInputTokens
        : rawInputTokens - cachedInputTokens;

      const cacheWriteTokens = safeNum(
        toNumber(
          input.metadata?.['anthropic']?.['cacheCreationInputTokens'] ??
            // @ts-expect-error - bedrock metadata structure may vary
            input.metadata?.['bedrock']?.['usage']?.['cacheWriteInputTokens'],
          'cacheWriteTokens'
        )
      );

      // Extract reasoning tokens - some providers nest it inside outputTokens
      // e.g., outputTokens: { total: 562, text: -805, reasoning: 1367 }
      // See: https://github.com/link-assistant/agent/issues/127
      const topLevelReasoningTokens = safeNum(
        toNumber(effectiveUsage?.reasoningTokens, 'reasoningTokens')
      );
      const outputTokensObj = effectiveUsage.outputTokens;
      const nestedReasoning =
        typeof outputTokensObj === 'object' && outputTokensObj !== null
          ? safeNum(
              toNumber(
                (outputTokensObj as { reasoning?: unknown }).reasoning,
                'outputTokens.reasoning'
              )
            )
          : 0;
      const reasoningTokens = topLevelReasoningTokens || nestedReasoning;

      const tokens = {
        input: Math.max(0, adjustedInputTokens), // Ensure non-negative
        output: safeNum(toNumber(effectiveUsage.outputTokens, 'outputTokens')),
        reasoning: reasoningTokens,
        cache: {
          write: cacheWriteTokens,
          read: cachedInputTokens,
        },
      };

      const costInfo =
        input.model.cost?.context_over_200k &&
        tokens.input + tokens.cache.read > 200_000
          ? input.model.cost.context_over_200k
          : input.model.cost;

      // Calculate cost using toDecimal for safe Decimal construction
      const costDecimal = toDecimal(0, 'cost_base')
        .add(
          toDecimal(tokens.input, 'tokens.input')
            .mul(toDecimal(costInfo?.input ?? 0, 'costInfo.input'))
            .div(1_000_000)
        )
        .add(
          toDecimal(tokens.output, 'tokens.output')
            .mul(toDecimal(costInfo?.output ?? 0, 'costInfo.output'))
            .div(1_000_000)
        )
        .add(
          toDecimal(tokens.cache.read, 'tokens.cache.read')
            .mul(toDecimal(costInfo?.cache_read ?? 0, 'costInfo.cache_read'))
            .div(1_000_000)
        )
        .add(
          toDecimal(tokens.cache.write, 'tokens.cache.write')
            .mul(toDecimal(costInfo?.cache_write ?? 0, 'costInfo.cache_write'))
            .div(1_000_000)
        )
        // TODO: update models.dev to have better pricing model, for now:
        // charge reasoning tokens at the same rate as output tokens
        .add(
          toDecimal(tokens.reasoning, 'tokens.reasoning')
            .mul(
              toDecimal(costInfo?.output ?? 0, 'costInfo.output_for_reasoning')
            )
            .div(1_000_000)
        );

      // Convert to number, defaulting to 0 if result is NaN or not finite
      const cost =
        costDecimal.isNaN() || !costDecimal.isFinite()
          ? 0
          : costDecimal.toNumber();

      return {
        cost,
        tokens,
      };
    }
  );

  export class BusyError extends Error {
    constructor(public readonly sessionID: string) {
      super(`Session ${sessionID} is busy`);
    }
  }

  export const initialize = fn(
    z.object({
      sessionID: Identifier.schema('session'),
      modelID: z.string(),
      providerID: z.string(),
      messageID: Identifier.schema('message'),
    }),
    async (input) => {
      await SessionPrompt.command({
        sessionID: input.sessionID,
        messageID: input.messageID,
        model: input.providerID + '/' + input.modelID,
        command: Command.Default.INIT,
        arguments: '',
      });
    }
  );
}
