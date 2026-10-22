import type { ModelMessage, ToolResultPart } from 'ai';
import { mergeDeep, unique } from 'remeda';
import type { JSONSchema } from 'zod/v4/core';

export namespace ProviderTransform {
  /**
   * Replace lone UTF-16 surrogates, which strict JSON parsers reject with a
   * 400 on every later turn (upstream #25934).
   */
  export function sanitizeSurrogates(content: string) {
    return content.replace(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
      '�'
    );
  }

  function sanitizeToolResult(part: ToolResultPart) {
    const output = part.output;
    if (output.type === 'text' || output.type === 'error-text') {
      return {
        ...part,
        output: { ...output, value: sanitizeSurrogates(output.value) },
      };
    }
    if (output.type === 'content') {
      return {
        ...part,
        output: {
          ...output,
          value: output.value.map((item) =>
            item.type === 'text'
              ? { ...item, text: sanitizeSurrogates(item.text) }
              : item
          ),
        },
      };
    }
    return part;
  }

  function sanitizeMessages(msgs: ModelMessage[]): ModelMessage[] {
    return msgs.map((msg) => {
      if (typeof msg.content === 'string') {
        return {
          ...msg,
          content: sanitizeSurrogates(msg.content),
        } as typeof msg;
      }
      if (!Array.isArray(msg.content)) return msg;
      return {
        ...msg,
        content: msg.content.map((part: any) => {
          if (part.type === 'text' || part.type === 'reasoning') {
            return { ...part, text: sanitizeSurrogates(part.text) };
          }
          if (part.type === 'tool-result') return sanitizeToolResult(part);
          return part;
        }),
      } as typeof msg;
    });
  }

  /**
   * Anthropic and Bedrock reject empty text blocks; keep reasoning that is
   * signed or redacted (upstream #14586, #26276).
   */
  function dropEmptyParts(msgs: ModelMessage[], npm?: string) {
    if (npm !== '@ai-sdk/anthropic' && npm !== '@ai-sdk/amazon-bedrock') {
      return msgs;
    }
    const ns = npm === '@ai-sdk/anthropic' ? 'anthropic' : 'bedrock';
    return msgs
      .map((msg) => {
        if (typeof msg.content === 'string') {
          return msg.content === '' ? undefined : msg;
        }
        if (!Array.isArray(msg.content)) return msg;
        const filtered = (msg.content as any[]).filter((part) => {
          if (part.type === 'text') return part.text !== '';
          if (part.type === 'reasoning') {
            return (
              part.text.trim().length > 0 ||
              part.providerOptions?.[ns]?.signature != null ||
              part.providerOptions?.[ns]?.redactedData != null
            );
          }
          return true;
        });
        if (filtered.length === 0) return undefined;
        return { ...msg, content: filtered } as typeof msg;
      })
      .filter((msg): msg is ModelMessage => msg !== undefined);
  }

  function normalizeMessages(
    msgs: ModelMessage[],
    providerID: string,
    modelID: string
  ): ModelMessage[] {
    if (modelID.includes('claude')) {
      return msgs.map((msg) => {
        if (
          (msg.role === 'assistant' || msg.role === 'tool') &&
          Array.isArray(msg.content)
        ) {
          msg.content = msg.content.map((part) => {
            if (
              (part.type === 'tool-call' || part.type === 'tool-result') &&
              'toolCallId' in part
            ) {
              return {
                ...part,
                toolCallId: part.toolCallId.replace(/[^a-zA-Z0-9_-]/g, '_'),
              };
            }
            return part;
          });
        }
        return msg;
      });
    }
    if (providerID === 'mistral' || modelID.toLowerCase().includes('mistral')) {
      const result: ModelMessage[] = [];
      for (let i = 0; i < msgs.length; i++) {
        const msg = msgs[i];
        const prevMsg = msgs[i - 1];
        const nextMsg = msgs[i + 1];

        if (
          (msg.role === 'assistant' || msg.role === 'tool') &&
          Array.isArray(msg.content)
        ) {
          msg.content = msg.content.map((part) => {
            if (
              (part.type === 'tool-call' || part.type === 'tool-result') &&
              'toolCallId' in part
            ) {
              // Mistral requires alphanumeric tool call IDs with exactly 9 characters
              const normalizedId = part.toolCallId
                .replace(/[^a-zA-Z0-9]/g, '') // Remove non-alphanumeric characters
                .substring(0, 9) // Take first 9 characters
                .padEnd(9, '0'); // Pad with zeros if less than 9 characters

              return {
                ...part,
                toolCallId: normalizedId,
              };
            }
            return part;
          });
        }

        result.push(msg);

        // Fix message sequence: tool messages cannot be followed by user messages
        if (msg.role === 'tool' && nextMsg?.role === 'user') {
          result.push({
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: 'Done.',
              },
            ],
          });
        }
      }
      return result;
    }

    return msgs;
  }

  function applyCaching(
    msgs: ModelMessage[],
    providerID: string,
    npm?: string
  ): ModelMessage[] {
    const system = msgs.filter((msg) => msg.role === 'system').slice(0, 2);
    const final = msgs.filter((msg) => msg.role !== 'system').slice(-2);

    const providerOptions = {
      anthropic: {
        cacheControl: { type: 'ephemeral' },
      },
      openrouter: {
        cache_control: { type: 'ephemeral' },
      },
      // Bedrock only accepts the 'default' cache point (upstream #11664).
      bedrock: {
        cachePoint: { type: 'default' },
      },
      openaiCompatible: {
        cache_control: { type: 'ephemeral' },
      },
    };

    // Bedrock reads the cache point from the message (upstream #18959).
    const useMessageLevelOptions =
      providerID === 'anthropic' ||
      providerID.includes('bedrock') ||
      npm === '@ai-sdk/amazon-bedrock';

    for (const msg of unique([...system, ...final])) {
      const shouldUseContentOptions =
        !useMessageLevelOptions &&
        Array.isArray(msg.content) &&
        msg.content.length > 0;

      // Deep-merge so signatures already in providerOptions survive (upstream #10323).
      if (shouldUseContentOptions) {
        const lastContent = msg.content[msg.content.length - 1];
        if (lastContent && typeof lastContent === 'object') {
          lastContent.providerOptions = mergeDeep(
            lastContent.providerOptions ?? {},
            providerOptions
          ) as typeof lastContent.providerOptions;
          continue;
        }
      }

      msg.providerOptions = mergeDeep(
        msg.providerOptions ?? {},
        providerOptions
      ) as typeof msg.providerOptions;
    }

    return msgs;
  }

  export function message(
    msgs: ModelMessage[],
    providerID: string,
    modelID: string,
    npm?: string
  ) {
    msgs = sanitizeMessages(msgs);
    msgs = dropEmptyParts(msgs, npm);
    msgs = normalizeMessages(msgs, providerID, modelID);
    if (
      providerID === 'anthropic' ||
      modelID.includes('anthropic') ||
      modelID.includes('claude')
    ) {
      msgs = applyCaching(msgs, providerID, npm);
    }

    return msgs;
  }

  export function temperature(_providerID: string, modelID: string) {
    if (modelID.toLowerCase().includes('qwen')) return 0.55;
    if (modelID.toLowerCase().includes('claude')) return undefined;
    if (modelID.toLowerCase().includes('gemini-3-pro')) return 1.0;
    return 0;
  }

  export function topP(_providerID: string, modelID: string) {
    if (modelID.toLowerCase().includes('qwen')) return 1;
    return undefined;
  }

  /**
   * Catalogue providers whose chat-completions endpoint accepts an unscoped
   * `prompt_cache_key`, as audited by OpenCode
   * (packages/core/src/plugin/provider/prompt-cache-key.ts).
   * @see https://github.com/link-assistant/agent/issues/334
   */
  export const PROMPT_CACHE_KEY_PROVIDERS = new Set([
    'abliteration-ai',
    'aihubmix',
    'anyapi',
    'auriko',
    'edenai',
    'jalapeno',
    'llama',
    'morph',
    'snowflake-cortex',
    'tencent-tokenhub',
    'upstage',
    'venice',
  ]);

  export function options(
    providerID: string,
    modelID: string,
    npm: string,
    sessionID: string
  ): Record<string, any> | undefined {
    const result: Record<string, any> = {};

    if (
      npm === '@ai-sdk/openai-compatible' &&
      PROMPT_CACHE_KEY_PROVIDERS.has(providerID)
    ) {
      // Unknown openai-compatible options are sent verbatim in the body.
      result['prompt_cache_key'] = sessionID;
    }

    if (providerID === 'openai') {
      result['promptCacheKey'] = sessionID;
    }

    if (modelID.includes('gpt-5') && !modelID.includes('gpt-5-chat')) {
      if (modelID.includes('codex')) {
        result['store'] = false;
      }

      if (!modelID.includes('codex') && !modelID.includes('gpt-5-pro')) {
        result['reasoningEffort'] = 'medium';
      }

      if (modelID.endsWith('gpt-5.1') && providerID !== 'azure') {
        result['textVerbosity'] = 'low';
      }

      if (providerID === 'opencode') {
        result['promptCacheKey'] = sessionID;
        result['include'] = ['reasoning.encrypted_content'];
        result['reasoningSummary'] = 'auto';
      }
    }
    return result;
  }

  export function providerOptions(
    npm: string | undefined,
    providerID: string,
    options: { [x: string]: any }
  ) {
    switch (npm) {
      case '@ai-sdk/openai':
      case '@ai-sdk/azure':
        return {
          ['openai' as string]: options,
        };
      case '@ai-sdk/amazon-bedrock':
        return {
          ['bedrock' as string]: options,
        };
      case '@ai-sdk/anthropic':
        return {
          ['anthropic' as string]: options,
        };
      case '@ai-sdk/gateway':
        return {
          ['gateway' as string]: options,
        };
      default:
        return {
          [providerID]: options,
        };
    }
  }

  export function maxOutputTokens(
    npm: string,
    options: Record<string, any>,
    modelLimit: number,
    globalLimit: number
  ): number {
    const modelCap = modelLimit || globalLimit;
    const standardLimit = Math.min(modelCap, globalLimit);

    if (npm === '@ai-sdk/anthropic') {
      const thinking = options?.['thinking'];
      const budgetTokens =
        typeof thinking?.['budgetTokens'] === 'number'
          ? thinking['budgetTokens']
          : 0;
      const enabled = thinking?.['type'] === 'enabled';
      if (enabled && budgetTokens > 0) {
        // Return text tokens so that text + thinking <= model cap, preferring 32k text when possible.
        if (budgetTokens + standardLimit <= modelCap) {
          return standardLimit;
        }
        return modelCap - budgetTokens;
      }
    }

    return standardLimit;
  }

  /**
   * Moonshot expands $ref before validating and rejects sibling keywords, and
   * it does not accept tuple-style `items` arrays (upstream #24730).
   */
  function sanitizeMoonshot(node: unknown): unknown {
    if (node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(sanitizeMoonshot);
    if ('$ref' in node && typeof node.$ref === 'string') {
      return { $ref: node.$ref };
    }
    const result: Record<string, unknown> = Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key, sanitizeMoonshot(value)])
    );
    if (Array.isArray(result.items)) result.items = result.items[0] ?? {};
    return result;
  }

  export function schema(
    providerID: string,
    modelID: string,
    schema: JSONSchema.BaseSchema
  ) {
    if (providerID === 'moonshotai' || modelID.toLowerCase().includes('kimi')) {
      schema = sanitizeMoonshot(schema) as JSONSchema.BaseSchema;
    }

    /*
    if (["openai", "azure"].includes(providerID)) {
      if (schema.type === "object" && schema.properties) {
        for (const [key, value] of Object.entries(schema.properties)) {
          if (schema.required?.includes(key)) continue
          schema.properties[key] = {
            anyOf: [
              value as JSONSchema.JSONSchema,
              {
                type: "null",
              },
            ],
          }
        }
      }
    }

    if (providerID === "google") {
    }
    */

    return schema;
  }
}
