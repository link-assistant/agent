import { test, expect, describe } from 'bun:test';
import { Decimal } from 'decimal.js';
import { Session } from '../src/session';

/**
 * Unit tests for Session.toDecimal(), Session.toNumber(), and Session.getUsage()
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

  test('returns Decimal(Infinity) for Infinity (Decimal accepts Infinity)', () => {
    const result = Session.toDecimal(Infinity);
    // Decimal.js accepts Infinity and creates Decimal(Infinity)
    expect(result.isNaN()).toBe(false);
    expect(result.isFinite()).toBe(false);
    expect(result.toString()).toBe('Infinity');
  });

  test('returns Decimal(-Infinity) for -Infinity (Decimal accepts -Infinity)', () => {
    const result = Session.toDecimal(-Infinity);
    // Decimal.js accepts -Infinity and creates Decimal(-Infinity)
    expect(result.isNaN()).toBe(false);
    expect(result.isFinite()).toBe(false);
    expect(result.toString()).toBe('-Infinity');
  });

  test('returns Decimal(NaN) for object input', () => {
    const result = Session.toDecimal({ count: 100 } as unknown);
    expect(result.isNaN()).toBe(true);
  });

  test('returns valid Decimal for numeric string input (Decimal accepts strings)', () => {
    // Decimal.js supports string input for numbers
    const result = Session.toDecimal('42' as unknown);
    expect(result.toNumber()).toBe(42);
    expect(result.isNaN()).toBe(false);
  });

  test('returns Decimal(NaN) for non-numeric string input', () => {
    const result = Session.toDecimal('abc' as unknown);
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

describe('Session.toNumber() - safe number conversion', () => {
  test('returns valid number for finite positive numbers', () => {
    const result = Session.toNumber(42);
    expect(result).toBe(42);
    expect(Number.isNaN(result)).toBe(false);
  });

  test('returns valid number for finite negative numbers', () => {
    const result = Session.toNumber(-100);
    expect(result).toBe(-100);
    expect(Number.isNaN(result)).toBe(false);
  });

  test('returns valid number for zero', () => {
    const result = Session.toNumber(0);
    expect(result).toBe(0);
    expect(Number.isNaN(result)).toBe(false);
  });

  test('returns valid number for decimal numbers', () => {
    const result = Session.toNumber(3.14159);
    expect(result).toBeCloseTo(3.14159, 5);
    expect(Number.isNaN(result)).toBe(false);
  });

  test('returns NaN for NaN input', () => {
    const result = Session.toNumber(NaN);
    expect(Number.isNaN(result)).toBe(true);
  });

  test('returns Infinity for Infinity input (Number accepts Infinity)', () => {
    const result = Session.toNumber(Infinity);
    expect(Number.isNaN(result)).toBe(false);
    expect(result).toBe(Infinity);
  });

  test('returns -Infinity for -Infinity input (Number accepts -Infinity)', () => {
    const result = Session.toNumber(-Infinity);
    expect(Number.isNaN(result)).toBe(false);
    expect(result).toBe(-Infinity);
  });

  test('returns NaN for object input', () => {
    const result = Session.toNumber({ count: 100 } as unknown);
    expect(Number.isNaN(result)).toBe(true);
  });

  test('returns valid number for numeric string input', () => {
    const result = Session.toNumber('42' as unknown);
    expect(result).toBe(42);
    expect(Number.isNaN(result)).toBe(false);
  });

  test('returns NaN for non-numeric string input', () => {
    const result = Session.toNumber('abc' as unknown);
    expect(Number.isNaN(result)).toBe(true);
  });

  test('returns 0 for undefined input (issue #127)', () => {
    // undefined is common for optional fields like cachedInputTokens, reasoningTokens
    // toNumber should gracefully return 0 instead of NaN
    const result = Session.toNumber(undefined);
    expect(result).toBe(0);
  });

  test('returns 0 for null input (issue #127)', () => {
    // null should be treated the same as undefined - return 0 gracefully
    const result = Session.toNumber(null);
    expect(result).toBe(0);
  });

  test('returns NaN for array input with multiple elements', () => {
    const result = Session.toNumber([1, 2, 3] as unknown);
    expect(Number.isNaN(result)).toBe(true);
  });

  test('returns number for single-element array (Number coercion)', () => {
    // Number([1]) returns 1 in JavaScript
    const result = Session.toNumber([1] as unknown);
    expect(result).toBe(1);
  });

  test('accepts optional context parameter for debugging', () => {
    // Context parameter should not affect behavior, just for logging
    const result1 = Session.toNumber(42, 'inputTokens');
    const result2 = Session.toNumber(NaN, 'outputTokens');
    expect(result1).toBe(42);
    expect(Number.isNaN(result2)).toBe(true);
  });

  test('can be used in arithmetic operations', () => {
    const a = Session.toNumber(100);
    const b = Session.toNumber(50);
    const result = (a + b) * 2;
    expect(result).toBe(300);
  });

  test('NaN propagates through arithmetic', () => {
    const valid = Session.toNumber(100);
    const invalid = Session.toNumber(NaN);
    const result = valid + invalid;
    expect(Number.isNaN(result)).toBe(true);
  });

  test('returns NaN for empty string', () => {
    const result = Session.toNumber('' as unknown);
    // Number('') is 0 in JavaScript, but we treat empty string as valid
    // Actually, Number('') === 0, so this should return 0
    expect(result).toBe(0);
  });

  test('returns NaN for whitespace string', () => {
    // Number('   ') === 0 in JavaScript (whitespace is coerced to 0)
    const result = Session.toNumber('   ' as unknown);
    expect(result).toBe(0);
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

  test('handles object with total field for inputTokens (issue #125 scenario)', () => {
    // This is the exact scenario from issue #125 where an object with 'total' field
    // is returned instead of a plain number on certain Bun versions
    const result = Session.getUsage({
      model: mockModel as any,
      usage: {
        inputTokens: { total: 8707, noCache: 6339, cacheRead: 2368 } as any,
        outputTokens: { total: 9, text: -119, reasoning: 128 } as any,
      },
    });

    // Should extract 'total' from objects instead of returning 0
    // With issue #127 fix, cacheRead (2368) is extracted and subtracted from total
    // input = 8707 - 2368 = 6339
    expect(result.tokens.input).toBe(6339);
    expect(result.tokens.output).toBe(9);
    expect(result.tokens.cache.read).toBe(2368);
    expect(result.tokens.reasoning).toBe(128);
    expect(typeof result.cost).toBe('number');
    expect(Number.isFinite(result.cost)).toBe(true);
  });
});

/**
 * Unit tests for Session.toNumber() - extended tests for issue #125
 * Tests for handling objects with 'total' field
 *
 * @see https://github.com/link-assistant/agent/issues/125
 */
describe('Session.toNumber() - object with total field (issue #125)', () => {
  test('extracts total from object with total field', () => {
    const result = Session.toNumber({
      total: 8707,
      noCache: 6339,
      cacheRead: 2368,
    } as unknown);
    expect(result).toBe(8707);
    expect(Number.isNaN(result)).toBe(false);
  });

  test('extracts total from object with only total field', () => {
    const result = Session.toNumber({ total: 100 } as unknown);
    expect(result).toBe(100);
  });

  test('extracts total from object with nested structure', () => {
    const result = Session.toNumber({
      total: 9,
      text: -119,
      reasoning: 128,
    } as unknown);
    expect(result).toBe(9);
  });

  test('returns NaN for object without total field', () => {
    const result = Session.toNumber({ count: 100, value: 200 } as unknown);
    expect(Number.isNaN(result)).toBe(true);
  });

  test('returns NaN for object with non-numeric total field', () => {
    const result = Session.toNumber({ total: 'not a number' } as unknown);
    expect(Number.isNaN(result)).toBe(true);
  });

  test('extracts total 0 from object correctly', () => {
    const result = Session.toNumber({ total: 0, other: 100 } as unknown);
    expect(result).toBe(0);
    expect(Number.isNaN(result)).toBe(false);
  });

  test('extracts negative total from object', () => {
    const result = Session.toNumber({ total: -50 } as unknown);
    expect(result).toBe(-50);
  });
});

/**
 * Unit tests for Session.toFinishReason() - safe conversion of finishReason
 * Tests for handling string, object, and edge cases
 *
 * @see https://github.com/link-assistant/agent/issues/125
 */
describe('Session.toFinishReason() - safe string conversion', () => {
  test('returns string unchanged', () => {
    expect(Session.toFinishReason('stop')).toBe('stop');
    expect(Session.toFinishReason('tool-calls')).toBe('tool-calls');
    expect(Session.toFinishReason('length')).toBe('length');
  });

  test('returns "unknown" for undefined', () => {
    expect(Session.toFinishReason(undefined)).toBe('unknown');
  });

  test('returns "unknown" for null', () => {
    expect(Session.toFinishReason(null)).toBe('unknown');
  });

  test('extracts type field from object', () => {
    expect(Session.toFinishReason({ type: 'stop' })).toBe('stop');
    expect(Session.toFinishReason({ type: 'tool-calls', other: 'data' })).toBe(
      'tool-calls'
    );
  });

  test('extracts finishReason field from object', () => {
    expect(Session.toFinishReason({ finishReason: 'stop' })).toBe('stop');
    expect(Session.toFinishReason({ finishReason: 'tool-calls' })).toBe(
      'tool-calls'
    );
  });

  test('extracts reason field from object', () => {
    expect(Session.toFinishReason({ reason: 'stop' })).toBe('stop');
  });

  test('prioritizes type over finishReason and reason', () => {
    expect(
      Session.toFinishReason({
        type: 'type-value',
        finishReason: 'fr-value',
        reason: 'r-value',
      })
    ).toBe('type-value');
  });

  test('falls back to finishReason when type is not a string', () => {
    expect(Session.toFinishReason({ type: 123, finishReason: 'stop' })).toBe(
      'stop'
    );
  });

  test('falls back to reason when type and finishReason are not strings', () => {
    expect(
      Session.toFinishReason({ type: {}, finishReason: null, reason: 'stop' })
    ).toBe('stop');
  });

  test('returns JSON for object without recognized fields', () => {
    const result = Session.toFinishReason({ unknown: 'value' });
    expect(result).toBe('{"unknown":"value"}');
  });

  test('converts number to string', () => {
    expect(Session.toFinishReason(123)).toBe('123');
  });

  test('converts boolean to string', () => {
    expect(Session.toFinishReason(true)).toBe('true');
    expect(Session.toFinishReason(false)).toBe('false');
  });

  test('handles empty object', () => {
    const result = Session.toFinishReason({});
    expect(result).toBe('{}');
  });

  // Issue #129: AI SDK returns finishReason as {unified: "tool-calls", raw: "tool_calls"}
  // This caused the loop to exit prematurely because the comparison with 'tool-calls' failed
  // @see https://github.com/link-assistant/agent/issues/129
  test('extracts unified field from AI SDK format object (issue #129)', () => {
    // This is the exact format returned by opencode provider
    expect(
      Session.toFinishReason({ unified: 'tool-calls', raw: 'tool_calls' })
    ).toBe('tool-calls');
  });

  test('extracts unified field for different finish reasons', () => {
    expect(Session.toFinishReason({ unified: 'stop', raw: 'stop' })).toBe(
      'stop'
    );
    expect(Session.toFinishReason({ unified: 'length', raw: 'length' })).toBe(
      'length'
    );
    expect(
      Session.toFinishReason({ unified: 'end-turn', raw: 'end_turn' })
    ).toBe('end-turn');
  });

  test('prioritizes type over unified field', () => {
    // If both type and unified are present, type should win (existing behavior)
    expect(
      Session.toFinishReason({
        type: 'type-value',
        unified: 'unified-value',
        raw: 'raw-value',
      })
    ).toBe('type-value');
  });

  test('prioritizes finishReason over unified field', () => {
    expect(
      Session.toFinishReason({
        finishReason: 'fr-value',
        unified: 'unified-value',
      })
    ).toBe('fr-value');
  });

  test('prioritizes reason over unified field', () => {
    expect(
      Session.toFinishReason({
        reason: 'reason-value',
        unified: 'unified-value',
      })
    ).toBe('reason-value');
  });

  test('falls back to unified when other fields are not strings', () => {
    expect(
      Session.toFinishReason({
        type: 123,
        finishReason: null,
        reason: {},
        unified: 'tool-calls',
      })
    ).toBe('tool-calls');
  });

  test('handles unified field with empty string', () => {
    // Empty string is still a valid string, so it should be returned
    expect(Session.toFinishReason({ unified: '', raw: 'tool_calls' })).toBe('');
  });

  test('ignores non-string unified field', () => {
    // If unified is not a string, fall back to JSON
    const result = Session.toFinishReason({ unified: 123, raw: 'tool_calls' });
    expect(result).toBe('{"unified":123,"raw":"tool_calls"}');
  });
});

/**
 * Unit tests for issue #127 - nested token extraction
 * Tests for extracting cacheRead from inputTokens and reasoning from outputTokens
 *
 * @see https://github.com/link-assistant/agent/issues/127
 */
describe('Session.getUsage() - nested token extraction (issue #127)', () => {
  const mockModel = {
    id: 'test-model',
    name: 'Test Model',
    provider: 'test',
    cost: {
      input: 3,
      output: 15,
      cache_read: 0.3,
      cache_write: 3.75,
    },
  };

  test('extracts cacheRead from inputTokens object when cachedInputTokens is undefined', () => {
    // This is the exact scenario from issue #127 with opencode/grok-code
    // cachedInputTokens is undefined, but cacheRead is nested inside inputTokens
    const result = Session.getUsage({
      model: mockModel as any,
      usage: {
        inputTokens: { total: 12703, noCache: 12511, cacheRead: 192 } as any,
        outputTokens: { total: 562, text: -805, reasoning: 1367 } as any,
        // cachedInputTokens is not provided
      },
    });

    expect(result.tokens.cache.read).toBe(192);
    // Input should be total minus cacheRead: 12703 - 192 = 12511
    expect(result.tokens.input).toBe(12511);
  });

  test('extracts reasoning from outputTokens object when reasoningTokens is undefined', () => {
    // reasoningTokens is undefined, but reasoning is nested inside outputTokens
    const result = Session.getUsage({
      model: mockModel as any,
      usage: {
        inputTokens: { total: 12703, noCache: 12511, cacheRead: 192 } as any,
        outputTokens: { total: 562, text: -805, reasoning: 1367 } as any,
        // reasoningTokens is not provided
      },
    });

    expect(result.tokens.reasoning).toBe(1367);
    expect(result.tokens.output).toBe(562);
  });

  test('prefers top-level cachedInputTokens over nested cacheRead', () => {
    const result = Session.getUsage({
      model: mockModel as any,
      usage: {
        inputTokens: { total: 1000, cacheRead: 100 } as any,
        outputTokens: 500,
        cachedInputTokens: 200, // Top-level takes precedence
      },
    });

    expect(result.tokens.cache.read).toBe(200);
    // Input should be total minus cachedInputTokens: 1000 - 200 = 800
    expect(result.tokens.input).toBe(800);
  });

  test('prefers top-level reasoningTokens over nested reasoning', () => {
    const result = Session.getUsage({
      model: mockModel as any,
      usage: {
        inputTokens: 1000,
        outputTokens: { total: 500, reasoning: 100 } as any,
        reasoningTokens: 200, // Top-level takes precedence
      },
    });

    expect(result.tokens.reasoning).toBe(200);
    expect(result.tokens.output).toBe(500);
  });

  test('handles inputTokens as plain number (no nested cacheRead)', () => {
    const result = Session.getUsage({
      model: mockModel as any,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        // No cachedInputTokens, inputTokens is plain number
      },
    });

    expect(result.tokens.cache.read).toBe(0);
    expect(result.tokens.input).toBe(1000);
  });

  test('handles outputTokens as plain number (no nested reasoning)', () => {
    const result = Session.getUsage({
      model: mockModel as any,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        // No reasoningTokens, outputTokens is plain number
      },
    });

    expect(result.tokens.reasoning).toBe(0);
    expect(result.tokens.output).toBe(500);
  });

  test('handles all undefined optional fields gracefully (issue #127 fix)', () => {
    // This tests that toNumber returns 0 for undefined instead of NaN
    const result = Session.getUsage({
      model: mockModel as any,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        // cachedInputTokens: undefined
        // reasoningTokens: undefined
      },
    });

    expect(result.tokens.input).toBe(1000);
    expect(result.tokens.output).toBe(500);
    expect(result.tokens.cache.read).toBe(0);
    expect(result.tokens.reasoning).toBe(0);
    expect(result.tokens.cache.write).toBe(0);
    expect(typeof result.cost).toBe('number');
    expect(Number.isFinite(result.cost)).toBe(true);
  });
});
