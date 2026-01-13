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
   * Safely extracts a numeric token value from API response data.
   * Returns 0 for invalid values and logs details in verbose mode.
   *
   * @param value - The raw value from API response (may be number, object, undefined, etc.)
   * @param context - Field name for debugging (e.g., "inputTokens")
   * @returns A safe numeric value (0 if invalid)
   */
  const safeTokenValue = (value: unknown, context: string): number => {
    // Handle undefined/null
    if (value === undefined || value === null) {
      return 0;
    }

    // Check if it's a valid finite number
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    // Invalid value - log details in verbose mode to help identify root cause
    if (Flag.OPENCODE_VERBOSE) {
      log.debug(() => ({
        message: 'Invalid token value received from API',
        context,
        valueType: typeof value,
        value:
          typeof value === 'object' ? JSON.stringify(value) : String(value),
        hint: 'This may indicate the API response format has changed or contains unexpected data',
      }));
    }

    return 0;
  };

  export const getUsage = fn(
    z.object({
      model: z.custom<ModelsDev.Model>(),
      usage: z.custom<LanguageModelUsage>(),
      metadata: z.custom<ProviderMetadata>().optional(),
    }),
    (input) => {
      // Log raw usage data in verbose mode for debugging
      if (Flag.OPENCODE_VERBOSE) {
        log.debug(() => ({
          message: 'getUsage called with raw data',
          rawUsage: JSON.stringify(input.usage),
          rawMetadata: input.metadata ? JSON.stringify(input.metadata) : 'none',
        }));
      }

      const cachedInputTokens = safeTokenValue(
        input.usage.cachedInputTokens,
        'cachedInputTokens'
      );
      const excludesCachedTokens = !!(
        input.metadata?.['anthropic'] || input.metadata?.['bedrock']
      );

      const rawInputTokens = safeTokenValue(
        input.usage.inputTokens,
        'inputTokens'
      );
      const adjustedInputTokens = excludesCachedTokens
        ? rawInputTokens
        : rawInputTokens - cachedInputTokens;

      const cacheWriteTokens = safeTokenValue(
        input.metadata?.['anthropic']?.['cacheCreationInputTokens'] ??
          // @ts-expect-error - bedrock metadata structure may vary
          input.metadata?.['bedrock']?.['usage']?.['cacheWriteInputTokens'],
        'cacheWriteTokens'
      );

      const tokens = {
        input: Math.max(0, adjustedInputTokens), // Ensure non-negative
        output: safeTokenValue(input.usage.outputTokens, 'outputTokens'),
        reasoning: safeTokenValue(
          input.usage?.reasoningTokens,
          'reasoningTokens'
        ),
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
