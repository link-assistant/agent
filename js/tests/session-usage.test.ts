import { test, expect, describe } from 'bun:test';
import { Session } from '../src/session';

/**
 * Unit tests for Session.safe() and Session.getUsage()
 * These tests verify the fix for issue #119: DecimalError when token data contains
 * non-numeric values (objects, NaN, Infinity).
 *
 * @see https://github.com/link-assistant/agent/issues/119
 */

describe('Session.safe() - numeric value sanitization', () => {
  test('returns 0 for NaN', () => {
    expect(Session.safe(NaN)).toBe(0);
  });

  test('returns 0 for Infinity', () => {
    expect(Session.safe(Infinity)).toBe(0);
  });

  test('returns 0 for -Infinity', () => {
    expect(Session.safe(-Infinity)).toBe(0);
  });

  test('returns original value for positive finite number', () => {
    expect(Session.safe(42)).toBe(42);
    expect(Session.safe(3.14159)).toBe(3.14159);
    expect(Session.safe(1000000)).toBe(1000000);
  });

  test('returns original value for negative finite number', () => {
    expect(Session.safe(-100)).toBe(-100);
    expect(Session.safe(-0.5)).toBe(-0.5);
  });

  test('returns original value for zero', () => {
    expect(Session.safe(0)).toBe(0);
    // Note: JavaScript treats -0 === 0 as true, but Object.is(-0, 0) is false
    // The safe() function correctly returns -0 as-is (which is a finite number)
    expect(Number.isFinite(Session.safe(-0))).toBe(true);
  });

  test('returns 0 for object coerced to number (becomes NaN)', () => {
    // When an object is passed where a number is expected, Number() coerces it to NaN
    const objectAsNumber = Number({ count: 100 });
    expect(Session.safe(objectAsNumber)).toBe(0);
  });

  test('returns 0 for undefined coerced to number', () => {
    const undefinedAsNumber = Number(undefined);
    expect(Session.safe(undefinedAsNumber)).toBe(0);
  });

  test('handles result of division by zero (Infinity)', () => {
    expect(Session.safe(1 / 0)).toBe(0);
    expect(Session.safe(-1 / 0)).toBe(0);
  });

  test('handles result of invalid arithmetic (NaN)', () => {
    expect(Session.safe(0 / 0)).toBe(0);
    expect(Session.safe(Math.sqrt(-1))).toBe(0);
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
});
