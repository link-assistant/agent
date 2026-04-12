import { Log } from './log';
import { isVerbose } from '../config/config';

const log = Log.create({ service: 'sse-usage' });

export interface SSEUsageData {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  timestamp: number;
}

const pendingUsage = new Map<string, SSEUsageData>();
let requestCounter = 0;

export namespace SSEUsageExtractor {
  export function nextRequestId(): string {
    return `sse-req-${++requestCounter}`;
  }

  export function extractUsageFromSSEChunk(
    chunk: string
  ): SSEUsageData | undefined {
    const lines = chunk.split('\n');
    let lastUsage: SSEUsageData | undefined;

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        const usage =
          parsed.usage ?? parsed.x_groq?.usage ?? parsed.choices?.[0]?.usage;

        if (usage && typeof usage === 'object') {
          const prompt =
            usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens;
          const completion =
            usage.completion_tokens ??
            usage.output_tokens ??
            usage.completionTokens;
          const total =
            usage.total_tokens ?? usage.totalTokens ?? prompt + completion;

          if (
            typeof prompt === 'number' &&
            typeof completion === 'number' &&
            (prompt > 0 || completion > 0)
          ) {
            lastUsage = {
              promptTokens: prompt,
              completionTokens: completion,
              totalTokens:
                typeof total === 'number' ? total : prompt + completion,
              cachedTokens:
                usage.prompt_tokens_details?.cached_tokens ??
                usage.cache_read_input_tokens ??
                usage.cachedTokens ??
                undefined,
              reasoningTokens:
                usage.completion_tokens_details?.reasoning_tokens ??
                usage.reasoning_tokens ??
                undefined,
              timestamp: Date.now(),
            };
          }
        }
      } catch {
        // Not valid JSON — skip
      }
    }

    return lastUsage;
  }

  export function processStreamForUsage(
    requestId: string,
    streamBody: string
  ): void {
    const usage = extractUsageFromSSEChunk(streamBody);
    if (usage) {
      pendingUsage.set(requestId, usage);
      if (isVerbose()) {
        log.info('raw SSE usage extracted', {
          requestId,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          cachedTokens: usage.cachedTokens,
          reasoningTokens: usage.reasoningTokens,
        });
      }
    }
  }

  export function getUsage(requestId: string): SSEUsageData | undefined {
    return pendingUsage.get(requestId);
  }

  export function consumeUsage(requestId: string): SSEUsageData | undefined {
    const usage = pendingUsage.get(requestId);
    if (usage) {
      pendingUsage.delete(requestId);
    }
    return usage;
  }

  export function getLatestUsage(): SSEUsageData | undefined {
    let latest: SSEUsageData | undefined;
    for (const usage of pendingUsage.values()) {
      if (!latest || usage.timestamp > latest.timestamp) {
        latest = usage;
      }
    }
    return latest;
  }

  export function consumeLatestUsage(): SSEUsageData | undefined {
    let latestKey: string | undefined;
    let latestUsage: SSEUsageData | undefined;
    for (const [key, usage] of pendingUsage.entries()) {
      if (!latestUsage || usage.timestamp > latestUsage.timestamp) {
        latestKey = key;
        latestUsage = usage;
      }
    }
    if (latestKey) {
      pendingUsage.delete(latestKey);
    }
    return latestUsage;
  }

  export function clear(): void {
    pendingUsage.clear();
  }

  export function size(): number {
    return pendingUsage.size;
  }
}
