/**
 * Cache Provider - A synthetic provider for caching API responses
 *
 * This provider caches API responses to enable deterministic testing.
 * When a response is not cached, it falls back to the echo provider behavior.
 * Cached responses are stored using Links Notation format (.lino files).
 *
 * Usage:
 *   agent --model link-assistant/cache/opencode -p "hello"  # Uses cached responses
 *
 * Cache location: ./data/api-cache/{provider}/{model}/
 * Format: Links Notation files with .lino extension
 *
 * @see https://github.com/link-assistant/agent/issues/89
 * @see https://github.com/link-foundation/lino-objects-codec
 */

import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
} from '@ai-sdk/provider';
import { Log } from '../util/log';
import { createEchoModel } from './echo';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
// @ts-ignore - lino-objects-codec is a JavaScript library
import { encode, decode } from 'lino-objects-codec';

const log = Log.create({ service: 'provider.cache' });

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_ROOT = join(__dirname, '../../data/api-cache');

/**
 * Generate a cache key from the prompt
 */
function generateCacheKey(
  prompt: LanguageModelV4CallOptions['prompt']
): string {
  // Simple hash of the prompt content
  const content = JSON.stringify(prompt);
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Get cache file path for a provider/model combination
 * Uses .lino extension for Links Notation format
 */
function getCachePath(provider: string, model: string, key: string): string {
  return join(CACHE_ROOT, provider, model, `${key}.lino`);
}

/**
 * Generate a unique ID for streaming parts
 */
function generatePartId(): string {
  return `cache_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Load cached response from file using Links Notation format
 */
function loadCachedResponse(
  filePath: string
): LanguageModelV4GenerateResult | null {
  try {
    if (!existsSync(filePath)) {
      return null;
    }
    const content = readFileSync(filePath, 'utf8');
    // Decode from Links Notation format
    const cached = decode({ notation: content });
    // Existing .lino files may contain AI SDK 6 responses. Normalize their
    // finish reason and usage so they remain usable by AI SDK 7.
    if (typeof cached?.finishReason === 'string') {
      const promptTokens = cached.usage?.promptTokens ?? 0;
      const completionTokens = cached.usage?.completionTokens ?? 0;
      return {
        ...cached,
        finishReason: {
          unified: cached.finishReason,
          raw: cached.finishReason,
        },
        usage: {
          inputTokens: {
            total: promptTokens,
            noCache: promptTokens,
            cacheRead: 0,
            cacheWrite: 0,
          },
          outputTokens: {
            total: completionTokens,
            text: completionTokens,
            reasoning: 0,
          },
        },
      };
    }
    return cached;
  } catch (error: any) {
    log.warn('Failed to load cached response', {
      filePath,
      error: error.message,
    });
    return null;
  }
}

/**
 * Save response to cache file using Links Notation format
 */
function saveCachedResponse(filePath: string, response: any): void {
  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    // Encode to Links Notation format
    const encoded = encode({ obj: response });
    writeFileSync(filePath, encoded, 'utf8');
    log.info('Saved cached response', { filePath });
  } catch (error: any) {
    log.warn('Failed to save cached response', {
      filePath,
      error: error.message,
    });
  }
}

/**
 * Creates a cache language model that stores/retrieves responses
 * Implements the AI SDK 7 language model interface.
 */
export function createCacheModel(
  providerId: string,
  modelId: string
): LanguageModelV4 {
  const model: LanguageModelV4 = {
    specificationVersion: 'v4',
    provider: 'link-assistant',
    modelId: `${providerId}/${modelId}`,

    // No external URLs are supported by this synthetic provider
    supportedUrls: {},

    async doGenerate(options: LanguageModelV4CallOptions) {
      const cacheKey = generateCacheKey(options.prompt);
      const cachePath = getCachePath(providerId, modelId, cacheKey);

      // Try to load from cache first
      const cached = loadCachedResponse(cachePath);
      if (cached) {
        log.info('Using cached response', { providerId, modelId, cacheKey });
        return cached;
      }

      // Fall back to echo behavior
      log.info('No cached response, using echo fallback', {
        providerId,
        modelId,
        cacheKey,
      });
      const echoModel = createEchoModel(`${providerId}/${modelId}`);
      const response = await echoModel.doGenerate(options);

      // Save to cache for future use
      saveCachedResponse(cachePath, response);

      return response;
    },

    async doStream(options: LanguageModelV4CallOptions) {
      const cacheKey = generateCacheKey(options.prompt);
      const cachePath = getCachePath(providerId, modelId, cacheKey);

      // Try to load from cache first
      const cached = loadCachedResponse(cachePath);
      if (cached) {
        log.info('Using cached streaming response', {
          providerId,
          modelId,
          cacheKey,
        });

        // For cached responses, we need to simulate streaming
        // Extract the text from the cached response
        const echoText =
          cached.content?.[0]?.text || cached.text || 'Cached response';
        const textPartId = generatePartId();

        // Create a ReadableStream with LanguageModelV4StreamPart format.
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

            // Emit finish event
            controller.enqueue({
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage: cached.usage || {
                inputTokens: {
                  total: Math.ceil(echoText.length / 4),
                  noCache: Math.ceil(echoText.length / 4),
                  cacheRead: 0,
                  cacheWrite: 0,
                },
                outputTokens: {
                  total: Math.ceil(echoText.length / 4),
                  text: Math.ceil(echoText.length / 4),
                  reasoning: 0,
                },
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
        };
      }

      // Fall back to echo streaming behavior
      log.info('No cached streaming response, using echo fallback', {
        providerId,
        modelId,
        cacheKey,
      });
      const echoModel = createEchoModel(`${providerId}/${modelId}`);
      const response = await echoModel.doStream(options);

      // Note: We don't cache streaming responses as they're consumed immediately
      return response;
    },
  };

  return model;
}

/**
 * Cache provider factory function
 */
export function createCacheProvider(options?: { name?: string }) {
  return {
    languageModel(modelId: string): LanguageModelV4 {
      // Parse provider/model from modelId like "opencode/grok-code"
      const parts = modelId.split('/');
      if (parts.length < 2) {
        throw new Error(
          `Invalid cache model ID: ${modelId}. Expected format: provider/model`
        );
      }
      const [providerId, ...modelParts] = parts;
      const actualModelId = modelParts.join('/');

      return createCacheModel(providerId, actualModelId);
    },
    textEmbeddingModel() {
      throw new Error('Cache provider does not support text embeddings');
    },
  };
}

export const cacheProvider = createCacheProvider();
