/**
 * Echo Provider - A synthetic provider for testing dry-run mode
 *
 * This provider echoes back the user's input message without making actual API calls.
 * It's designed to enable robust testing of round-trips and multi-turn conversations
 * without incurring API costs.
 *
 * Usage:
 *   agent --dry-run -p "hello"  # Uses echo provider automatically
 *   agent --model link-assistant/echo -p "hello"  # Explicit usage
 *
 * The echo behavior follows the issue #89 specification:
 *   Input: "hi" -> Output: "hi"
 *   Input: "How are you?" -> Output: "How are you?"
 */

import type { LanguageModelV2, LanguageModelV2CallOptions } from 'ai';
import { Log } from '../util/log';

const log = Log.create({ service: 'provider.echo' });

/**
 * Extract text content from the prompt messages
 */
function extractTextFromPrompt(
  prompt: LanguageModelV2CallOptions['prompt']
): string {
  const textParts: string[] = [];

  for (const message of prompt) {
    if (message.role === 'user') {
      for (const part of message.content) {
        if (part.type === 'text') {
          textParts.push(part.text);
        }
      }
    }
  }

  // Return the last user message or a default response
  return textParts.length > 0
    ? textParts[textParts.length - 1]
    : 'Echo: No user message found';
}

/**
 * Generate a unique ID for streaming parts
 */
function generatePartId(): string {
  return `echo_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Creates an echo language model that echoes back the user's input
 * Implements LanguageModelV2 interface for AI SDK 6.x compatibility
 */
export function createEchoModel(modelId: string = 'echo'): LanguageModelV2 {
  const model: LanguageModelV2 = {
    specificationVersion: 'v2',
    provider: 'link-assistant',
    modelId,

    // No external URLs are supported by this synthetic provider
    supportedUrls: {},

    async doGenerate(options: LanguageModelV2CallOptions) {
      const echoText = extractTextFromPrompt(options.prompt);
      log.info('echo generate', { modelId, echoText });

      // Simulate token usage
      const promptTokens = Math.ceil(echoText.length / 4);
      const completionTokens = Math.ceil(echoText.length / 4);

      return {
        content: [
          {
            type: 'text' as const,
            text: echoText,
          },
        ],
        finishReason: 'stop' as const,
        usage: {
          promptTokens,
          completionTokens,
        },
        warnings: [],
        providerMetadata: undefined,
        request: undefined,
        response: undefined,
      };
    },

    async doStream(options: LanguageModelV2CallOptions) {
      const echoText = extractTextFromPrompt(options.prompt);
      log.info('echo stream', { modelId, echoText });

      // Simulate token usage
      const promptTokens = Math.ceil(echoText.length / 4);
      const completionTokens = Math.ceil(echoText.length / 4);

      const textPartId = generatePartId();

      // Create a ReadableStream with LanguageModelV2StreamPart format
      // V2 format uses: text-start -> text-delta (with delta) -> text-end -> finish
      const stream = new ReadableStream({
        async start(controller) {
          // Emit text-start
          controller.enqueue({
            type: 'text-start',
            id: textPartId,
            providerMetadata: undefined,
          });

          // Emit the text in chunks for realistic streaming behavior
          const chunkSize = 10;
          for (let i = 0; i < echoText.length; i += chunkSize) {
            const chunk = echoText.slice(i, i + chunkSize);
            controller.enqueue({
              type: 'text-delta',
              id: textPartId,
              delta: chunk,
              providerMetadata: undefined,
            });
          }

          // Emit text-end
          controller.enqueue({
            type: 'text-end',
            id: textPartId,
            providerMetadata: undefined,
          });

          // Emit finish event with usage information
          controller.enqueue({
            type: 'finish',
            finishReason: 'stop',
            usage: {
              promptTokens,
              completionTokens,
            },
            providerMetadata: undefined,
          });

          controller.close();
        },
      });

      return {
        stream,
        request: undefined,
        response: undefined,
        warnings: [],
      };
    },
  };

  return model;
}

/**
 * Echo provider factory function - follows AI SDK provider pattern
 */
export function createEchoProvider(options?: { name?: string }) {
  return {
    languageModel(modelId: string): LanguageModelV2 {
      return createEchoModel(modelId);
    },
    textEmbeddingModel() {
      throw new Error('Echo provider does not support text embeddings');
    },
  };
}

export const echoProvider = createEchoProvider();
