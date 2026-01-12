import { test, expect, describe } from 'bun:test';
import { Decimal } from 'decimal.js';
import { Session } from '../src/session';

/**
 * Unit tests for Session.toDecimal() and Session.getUsage()
 * These tests verify the fix for issue #119: DecimalError when token data contains
 * non-numeric values (objects, NaN, Infinity).
 *
 * @see https://github.com/link-assistant/agent/issues/119
 */

describe('Session.toDecimal() - safe Decimal conversion', () => {
  test('returns valid Decimal for finite positive numbers', () => {
    const result = Session.toDecimal(42);
    expect(result.toNumber()).toBe(42);
    expect(result.isNaN()).toBe(false);
  });

  test('returns valid Decimal for finite negative numbers', () => {
    const result = Session.toDecimal(-100);
    expect(result.toNumber()).toBe(-100);
    expect(result.isNaN()).toBe(false);
  });

  test('returns valid Decimal for zero', () => {
    const result = Session.toDecimal(0);
    expect(result.toNumber()).toBe(0);
    expect(result.isNaN()).toBe(false);
  });

  test('returns valid Decimal for decimal numbers', () => {
    const result = Session.toDecimal(3.14159);
    expect(result.toNumber()).toBeCloseTo(3.14159, 5);
    expect(result.isNaN()).toBe(false);
  });

  test('returns Decimal(NaN) for NaN input', () => {
    const result = Session.toDecimal(NaN);
    expect(result.isNaN()).toBe(true);
  });

  test('returns Decimal(NaN) for Infinity', () => {
    const result = Session.toDecimal(Infinity);
    expect(result.isNaN()).toBe(true);
  });

  test('returns Decimal(NaN) for -Infinity', () => {
    const result = Session.toDecimal(-Infinity);
    expect(result.isNaN()).toBe(true);
  });

  test('returns Decimal(NaN) for object input', () => {
    const result = Session.toDecimal({ count: 100 } as unknown);
    expect(result.isNaN()).toBe(true);
  });

  test('returns Decimal(NaN) for string input', () => {
    const result = Session.toDecimal('42' as unknown);
    expect(result.isNaN()).toBe(true);
  });

  test('returns Decimal(NaN) for undefined input', () => {
    const result = Session.toDecimal(undefined);
    expect(result.isNaN()).toBe(true);
  });

  test('returns Decimal(NaN) for null input', () => {
    const result = Session.toDecimal(null);
    expect(result.isNaN()).toBe(true);
  });

  test('returns Decimal(NaN) for array input', () => {
    const result = Session.toDecimal([1, 2, 3] as unknown);
    expect(result.isNaN()).toBe(true);
  });

  test('accepts optional context parameter for debugging', () => {
    // Context parameter should not affect behavior, just for logging
    const result1 = Session.toDecimal(42, 'inputTokens');
    const result2 = Session.toDecimal(NaN, 'outputTokens');
    expect(result1.toNumber()).toBe(42);
    expect(result2.isNaN()).toBe(true);
  });

  test('can be used in Decimal arithmetic', () => {
    const a = Session.toDecimal(100);
    const b = Session.toDecimal(50);
    const result = a.add(b).mul(2);
    expect(result.toNumber()).toBe(300);
  });

  test('NaN propagates through Decimal arithmetic', () => {
    const valid = Session.toDecimal(100);
    const invalid = Session.toDecimal(NaN);
    const result = valid.add(invalid);
    expect(result.isNaN()).toBe(true);
  });
});

describe('Session.getUsage() - token usage calculation', () => {
  // Mock model with cost information
  const mockModel = {
    id: 'test-model',
    name: 'Test Model',
    provider: 'test',
    cost: {
      input: 3, // $3 per million tokens
      output: 15, // $15 per million tokens
      cache_read: 0.3,
      cache_write: 3.75,
    },
  };

  const mockModelNoCost = {
    id: 'test-model-free',
    name: 'Test Model Free',
    provider: 'test',
    // No cost field
  };

  test('calculates correctly with valid token data', () => {
    const result = Session.getUsage({
      model: mockModel as any,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        cachedInputTokens: 0,
      },
    });

    expect(result.tokens.input).toBe(1000);
    expect(result.tokens.output).toBe(500);
    expect(result.tokens.reasoning).toBe(0);
    expect(result.tokens.cache.read).toBe(0);
    expect(result.tokens.cache.write).toBe(0);
    // Cost = (1000 * 3 / 1000000) + (500 * 15 / 1000000) = 0.003 + 0.0075 = 0.0105
    expect(result.cost).toBeCloseTo(0.0105, 6);
  });

  test('handles NaN in inputTokens without crashing', () => {
    const result = Session.getUsage({
      model: mockModel as any,
      usage: {
        inputTokens: NaN,
        outputTokens: 100,
      },
    });

    expect(result.tokens.input).toBe(0);
    expect(result.tokens.output).toBe(100);
    expect(typeof result.cost).toBe('number');
    expect(Number.isFinite(result.cost)).toBe(true);
  });

  test('handles Infinity in outputTokens without crashing', () => {
    const result = Session.getUsage({
      model: mockModel as any,
      usage: {
        inputTokens: 100,
        outputTokens: Infinity,
      },
    });

    expect(result.tokens.input).toBe(100);
    expect(result.tokens.output).toBe(0); // Sanitized to 0
    expect(typeof result.cost).toBe('number');
    expect(Number.isFinite(result.cost)).toBe(true);
  });

  test('handles -Infinity in reasoningTokens without crashing', () => {
    const result = Session.getUsage({
      model: mockModel as any,
      usage: {
        inputTokens: 100,
        outputTokens: 100,
        reasoningTokens: -Infinity,
      },
    });

    expect(result.tokens.reasoning).toBe(0); // Sanitized to 0
    expect(typeof result.cost).toBe('number');
    expect(Number.isFinite(result.cost)).toBe(true);
  });

  test('handles undefined token values', () => {
    const result = Session.getUsage({
      model: mockModel as any,
      usage: {
        // All token values undefined
      } as any,
    });

    expect(result.tokens.input).toBe(0);
    expect(result.tokens.output).toBe(0);
    expect(result.tokens.reasoning).toBe(0);
    expect(result.cost).toBe(0);
  });

  test('handles model without cost information', () => {
    const result = Session.getUsage({
      model: mockModelNoCost as any,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
      },
    });

    expect(result.tokens.input).toBe(1000);
    expect(result.tokens.output).toBe(500);
    expect(result.cost).toBe(0); // No cost info means 0 cost
  });

  test('handles cached token calculation for Anthropic provider', () => {
    const result = Session.getUsage({
      model: mockModel as any,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        cachedInputTokens: 200,
      },
      metadata: {
        anthropic: {
          cacheCreationInputTokens: 100,
        },
      },
    });

    // For Anthropic, inputTokens excludes cached, so no subtraction needed
    expect(result.tokens.input).toBe(1000);
    expect(result.tokens.cache.read).toBe(200);
    expect(result.tokens.cache.write).toBe(100);
    expect(typeof result.cost).toBe('number');
  });

  test('handles cached token calculation for non-Anthropic provider', () => {
    const result = Session.getUsage({
      model: mockModel as any,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        cachedInputTokens: 200,
      },
      // No anthropic/bedrock metadata
    });

    // For non-Anthropic, inputTokens includes cached, so subtract
    expect(result.tokens.input).toBe(800); // 1000 - 200
    expect(result.tokens.cache.read).toBe(200);
  });

  test('handles all token fields being NaN simultaneously', () => {
    const result = Session.getUsage({
      model: mockModel as any,
      usage: {
        inputTokens: NaN,
        outputTokens: NaN,
        cachedInputTokens: NaN,
        reasoningTokens: NaN,
      },
    });

    expect(result.tokens.input).toBe(0);
    expect(result.tokens.output).toBe(0);
    expect(result.tokens.reasoning).toBe(0);
    expect(result.tokens.cache.read).toBe(0);
    expect(result.cost).toBe(0);
  });

  test('handles large valid token counts', () => {
    const result = Session.getUsage({
      model: mockModel as any,
      usage: {
        inputTokens: 500000,
        outputTokens: 100000,
      },
    });

    expect(result.tokens.input).toBe(500000);
    expect(result.tokens.output).toBe(100000);
    expect(typeof result.cost).toBe('number');
    expect(Number.isFinite(result.cost)).toBe(true);
  });

  test('returns consistent token structure regardless of input validity', () => {
    const validResult = Session.getUsage({
      model: mockModel as any,
      usage: {
        inputTokens: 100,
        outputTokens: 50,
      },
    });

    const invalidResult = Session.getUsage({
      model: mockModel as any,
      usage: {
        inputTokens: NaN,
        outputTokens: Infinity,
      },
    });

    // Both should have same structure
    expect(Object.keys(validResult)).toEqual(Object.keys(invalidResult));
    expect(Object.keys(validResult.tokens)).toEqual(
      Object.keys(invalidResult.tokens)
    );
    expect(Object.keys(validResult.tokens.cache)).toEqual(
      Object.keys(invalidResult.tokens.cache)
    );
  });

  test('handles object passed as token value (the original bug scenario)', () => {
    // This is the exact scenario from issue #119 where an object was passed
    // instead of a number, causing [DecimalError] Invalid argument: [object Object]
    const result = Session.getUsage({
      model: mockModel as any,
      usage: {
        inputTokens: { nested: 'object' } as any, // Object instead of number
        outputTokens: 100,
      },
    });

    // Should not crash, should return 0 for the invalid field
    expect(result.tokens.input).toBe(0);
    expect(result.tokens.output).toBe(100);
    expect(typeof result.cost).toBe('number');
    expect(Number.isFinite(result.cost)).toBe(true);
  });

  test('handles mixed valid and invalid token values', () => {
    const result = Session.getUsage({
      model: mockModel as any,
      usage: {
        inputTokens: 1000, // valid
        outputTokens: { invalid: true } as any, // invalid object
        cachedInputTokens: Infinity, // invalid
        reasoningTokens: 500, // valid
      },
    });

    expect(result.tokens.input).toBe(1000);
    expect(result.tokens.output).toBe(0);
    expect(result.tokens.cache.read).toBe(0);
    expect(result.tokens.reasoning).toBe(500);
    expect(typeof result.cost).toBe('number');
  });
});
