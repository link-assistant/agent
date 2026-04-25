import { describe, test, expect, beforeEach } from 'bun:test';
import { SSEUsageExtractor } from '../src/util/sse-usage-extractor';

describe('SSEUsageExtractor', () => {
  beforeEach(() => {
    SSEUsageExtractor.clear();
  });

  describe('extractUsageFromSSEChunk', () => {
    test('extracts OpenAI-format usage from SSE data', () => {
      const chunk = `data: {"id":"chatcmpl-123","choices":[],"usage":{"prompt_tokens":1500,"completion_tokens":80,"total_tokens":1580}}\n\ndata: [DONE]\n\n`;
      const result = SSEUsageExtractor.extractUsageFromSSEChunk(chunk);
      expect(result).toBeDefined();
      expect(result!.promptTokens).toBe(1500);
      expect(result!.completionTokens).toBe(80);
      expect(result!.totalTokens).toBe(1580);
    });

    test('extracts Anthropic-format usage (input_tokens/output_tokens)', () => {
      const chunk = `data: {"type":"message_delta","usage":{"input_tokens":2000,"output_tokens":150}}\n\n`;
      const result = SSEUsageExtractor.extractUsageFromSSEChunk(chunk);
      expect(result).toBeDefined();
      expect(result!.promptTokens).toBe(2000);
      expect(result!.completionTokens).toBe(150);
    });

    test('extracts cached tokens from prompt_tokens_details', () => {
      const chunk = `data: {"usage":{"prompt_tokens":5000,"completion_tokens":200,"total_tokens":5200,"prompt_tokens_details":{"cached_tokens":3000}}}\n\n`;
      const result = SSEUsageExtractor.extractUsageFromSSEChunk(chunk);
      expect(result).toBeDefined();
      expect(result!.cachedTokens).toBe(3000);
    });

    test('extracts reasoning tokens from completion_tokens_details', () => {
      const chunk = `data: {"usage":{"prompt_tokens":1000,"completion_tokens":500,"total_tokens":1500,"completion_tokens_details":{"reasoning_tokens":300}}}\n\n`;
      const result = SSEUsageExtractor.extractUsageFromSSEChunk(chunk);
      expect(result).toBeDefined();
      expect(result!.reasoningTokens).toBe(300);
    });

    test('extracts Anthropic cache_read_input_tokens', () => {
      const chunk = `data: {"usage":{"input_tokens":4000,"output_tokens":100,"cache_read_input_tokens":2500}}\n\n`;
      const result = SSEUsageExtractor.extractUsageFromSSEChunk(chunk);
      expect(result).toBeDefined();
      expect(result!.cachedTokens).toBe(2500);
    });

    test('returns last usage when multiple SSE events contain usage', () => {
      const chunk = [
        `data: {"usage":{"prompt_tokens":100,"completion_tokens":10,"total_tokens":110}}`,
        ``,
        `data: {"usage":{"prompt_tokens":200,"completion_tokens":20,"total_tokens":220}}`,
        ``,
        `data: [DONE]`,
        ``,
      ].join('\n');
      const result = SSEUsageExtractor.extractUsageFromSSEChunk(chunk);
      expect(result).toBeDefined();
      expect(result!.promptTokens).toBe(200);
      expect(result!.completionTokens).toBe(20);
    });

    test('returns undefined for SSE data without usage', () => {
      const chunk = `data: {"id":"chatcmpl-123","choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n`;
      const result = SSEUsageExtractor.extractUsageFromSSEChunk(chunk);
      expect(result).toBeUndefined();
    });

    test('returns undefined for empty input', () => {
      expect(SSEUsageExtractor.extractUsageFromSSEChunk('')).toBeUndefined();
    });

    test('returns undefined for usage with all zeros', () => {
      const chunk = `data: {"usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0}}\n\n`;
      const result = SSEUsageExtractor.extractUsageFromSSEChunk(chunk);
      expect(result).toBeUndefined();
    });

    test('handles malformed JSON gracefully', () => {
      const chunk = `data: {invalid json}\ndata: {"usage":{"prompt_tokens":500,"completion_tokens":50,"total_tokens":550}}\n\n`;
      const result = SSEUsageExtractor.extractUsageFromSSEChunk(chunk);
      expect(result).toBeDefined();
      expect(result!.promptTokens).toBe(500);
    });

    test('extracts Groq-format usage from x_groq field', () => {
      const chunk = `data: {"x_groq":{"usage":{"prompt_tokens":800,"completion_tokens":100,"total_tokens":900}}}\n\n`;
      const result = SSEUsageExtractor.extractUsageFromSSEChunk(chunk);
      expect(result).toBeDefined();
      expect(result!.promptTokens).toBe(800);
      expect(result!.completionTokens).toBe(100);
    });
  });

  describe('processStreamForUsage / consumeUsage', () => {
    test('stores and retrieves usage by request ID', () => {
      const id = SSEUsageExtractor.nextRequestId();
      SSEUsageExtractor.processStreamForUsage(
        id,
        `data: {"usage":{"prompt_tokens":1000,"completion_tokens":50,"total_tokens":1050}}\n\n`
      );
      const usage = SSEUsageExtractor.getUsage(id);
      expect(usage).toBeDefined();
      expect(usage!.promptTokens).toBe(1000);
    });

    test('consumeUsage removes the entry', () => {
      const id = SSEUsageExtractor.nextRequestId();
      SSEUsageExtractor.processStreamForUsage(
        id,
        `data: {"usage":{"prompt_tokens":1000,"completion_tokens":50,"total_tokens":1050}}\n\n`
      );
      const usage = SSEUsageExtractor.consumeUsage(id);
      expect(usage).toBeDefined();
      expect(SSEUsageExtractor.getUsage(id)).toBeUndefined();
    });

    test('does not store when no usage found in stream', () => {
      const id = SSEUsageExtractor.nextRequestId();
      SSEUsageExtractor.processStreamForUsage(
        id,
        `data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n`
      );
      expect(SSEUsageExtractor.getUsage(id)).toBeUndefined();
    });
  });

  describe('consumeLatestUsage', () => {
    test('returns usage and removes it', () => {
      const id1 = SSEUsageExtractor.nextRequestId();
      SSEUsageExtractor.processStreamForUsage(
        id1,
        `data: {"usage":{"prompt_tokens":100,"completion_tokens":10,"total_tokens":110}}\n\n`
      );
      const latest = SSEUsageExtractor.consumeLatestUsage();
      expect(latest).toBeDefined();
      expect(latest!.promptTokens).toBe(100);
      expect(SSEUsageExtractor.size()).toBe(0);
    });

    test('returns undefined when no usage stored', () => {
      expect(SSEUsageExtractor.consumeLatestUsage()).toBeUndefined();
    });
  });

  describe('OpenRouter real-world SSE format', () => {
    test('extracts usage from OpenRouter-style SSE response', () => {
      const sseData = [
        'data: {"id":"gen-123","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}',
        '',
        'data: {"id":"gen-123","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}',
        '',
        'data: {"id":"gen-123","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":15506,"completion_tokens":80,"total_tokens":15586,"prompt_tokens_details":{"cached_tokens":0},"completion_tokens_details":{"reasoning_tokens":0}}}',
        '',
        'data: [DONE]',
        '',
      ].join('\n');

      const result = SSEUsageExtractor.extractUsageFromSSEChunk(sseData);
      expect(result).toBeDefined();
      expect(result!.promptTokens).toBe(15506);
      expect(result!.completionTokens).toBe(80);
      expect(result!.totalTokens).toBe(15586);
      expect(result!.cachedTokens).toBe(0);
      expect(result!.reasoningTokens).toBe(0);
    });
  });
});
