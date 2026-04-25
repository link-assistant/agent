import { test, expect, describe } from 'bun:test';
import { Token } from '../src/util/token';

/**
 * Tests for Token estimation and counting utilities.
 *
 * @see https://github.com/link-assistant/agent/issues/249
 */

describe('Token.estimate', () => {
  test('returns 0 for empty string', () => {
    expect(Token.estimate('')).toBe(0);
  });

  test('returns 0 for falsy input', () => {
    // @ts-expect-error testing edge case
    expect(Token.estimate(null)).toBe(0);
    // @ts-expect-error testing edge case
    expect(Token.estimate(undefined)).toBe(0);
  });

  test('estimates ~4 characters per token', () => {
    // "hello world" = 11 chars → 11/4 = 2.75 → rounds to 3
    expect(Token.estimate('hello world')).toBe(3);
  });

  test('estimates longer text', () => {
    const text = 'a'.repeat(400);
    expect(Token.estimate(text)).toBe(100);
  });

  test('handles 1 character', () => {
    expect(Token.estimate('a')).toBe(0); // 1/4 = 0.25 → rounds to 0
  });

  test('handles 2 characters', () => {
    expect(Token.estimate('ab')).toBe(1); // 2/4 = 0.5 → rounds to 1
  });
});

describe('Token.countTokens', () => {
  test('returns 0 for empty string', () => {
    const result = Token.countTokens('');
    expect(result.count).toBe(0);
    expect(result.precise).toBe(true);
  });

  test('returns non-zero for real text', () => {
    const result = Token.countTokens(
      'Hello, world! This is a test of the tokenizer.'
    );
    expect(result.count).toBeGreaterThan(0);
    // If gpt-tokenizer is available, it should be precise
    // If not, it falls back to estimate
    expect(typeof result.precise).toBe('boolean');
  });

  test('uses BPE tokenizer when available (gpt-tokenizer)', () => {
    // gpt-tokenizer is installed as a dependency, so this should use real BPE
    const result = Token.countTokens('Hello world');
    // With o200k_base, "Hello world" is typically 2 tokens
    // The precise flag indicates real BPE was used
    if (result.precise) {
      // Real BPE: should be a small number of tokens for a short phrase
      expect(result.count).toBeLessThan(10);
      expect(result.count).toBeGreaterThan(0);
    }
  });

  test('gives reasonable count for larger text', () => {
    // ~1000 characters of typical English text
    const text = 'The quick brown fox jumps over the lazy dog. '.repeat(22);
    const result = Token.countTokens(text);
    // ~1000 chars should be roughly 200-300 tokens regardless of method
    expect(result.count).toBeGreaterThan(100);
    expect(result.count).toBeLessThan(500);
  });

  test('BPE count differs from heuristic estimate for code', () => {
    // Code tends to have a different token/char ratio than English prose
    const code = `function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}`;
    const bpeResult = Token.countTokens(code);
    const heuristicResult = Token.estimate(code);

    // Both should be reasonable, but may differ
    expect(bpeResult.count).toBeGreaterThan(0);
    expect(heuristicResult).toBeGreaterThan(0);

    if (bpeResult.precise) {
      // BPE tokenization typically produces more tokens for code due to
      // splitting on special characters, while heuristic uses flat 4 chars/token
      // They should be in the same order of magnitude
      expect(Math.abs(bpeResult.count - heuristicResult)).toBeLessThan(
        heuristicResult * 2
      );
    }
  });
});
