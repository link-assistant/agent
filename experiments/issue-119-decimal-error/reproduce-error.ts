/**
 * Experiment: Issue #119 - Reproduce DecimalError in getUsage()
 *
 * This script demonstrates how the DecimalError occurs when
 * token usage data contains non-numeric values like objects, NaN, or Infinity.
 *
 * Run with: bun run experiments/issue-119-decimal-error/reproduce-error.ts
 */

import { Decimal } from 'decimal.js';

console.log('=== Issue #119: DecimalError Reproduction ===\n');

// First, demonstrate the actual crash with Decimal.js directly
console.log('=== Demonstrating actual DecimalError crash ===\n');
try {
  const badValue = { count: 100 };
  console.log(`Attempting: new Decimal(${JSON.stringify(badValue)})`);
  const result = new Decimal(badValue as unknown as number);
  console.log('Result:', result.toString());
} catch (error) {
  console.log(`CRASHED with: ${(error as Error).message}`);
  console.log('This is the exact error from issue #119!\n');
}

// Simulate the original getUsage implementation (without safe wrapper)
function getUsageOriginal(usage: {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
}) {
  const cachedInputTokens = usage.cachedInputTokens ?? 0;
  const adjustedInputTokens = (usage.inputTokens ?? 0) - cachedInputTokens;

  const tokens = {
    input: adjustedInputTokens,
    output: usage.outputTokens ?? 0,
    reasoning: usage.reasoningTokens ?? 0,
    cache: {
      write: 0,
      read: cachedInputTokens,
    },
  };

  // This is where the crash happens - Decimal can't handle non-numeric values
  const cost = new Decimal(0)
    .add(new Decimal(tokens.input).mul(0.003).div(1_000_000))
    .add(new Decimal(tokens.output).mul(0.015).div(1_000_000))
    .toNumber();

  return { cost, tokens };
}

// Test cases that trigger the error
const testCases = [
  {
    name: 'Object in inputTokens',
    usage: { inputTokens: { count: 100 } as unknown as number },
    expectedError: true,
  },
  {
    name: 'NaN in inputTokens',
    usage: { inputTokens: NaN },
    expectedError: true,
  },
  {
    name: 'Infinity in outputTokens',
    usage: { outputTokens: Infinity },
    expectedError: true,
  },
  {
    name: '-Infinity in reasoningTokens',
    usage: { reasoningTokens: -Infinity },
    expectedError: true,
  },
  {
    name: 'Valid numeric data',
    usage: { inputTokens: 1000, outputTokens: 500 },
    expectedError: false,
  },
];

console.log('Testing ORIGINAL implementation (without safe wrapper):\n');

for (const testCase of testCases) {
  console.log(`Test: ${testCase.name}`);
  console.log(`  Input: ${JSON.stringify(testCase.usage)}`);

  try {
    const result = getUsageOriginal(testCase.usage);
    console.log(`  Result: ${JSON.stringify(result)}`);
    if (testCase.expectedError) {
      console.log(`  ERROR: Expected error but got success!`);
    } else {
      console.log(`  OK: Completed as expected`);
    }
  } catch (error) {
    console.log(`  Exception: ${(error as Error).message}`);
    if (testCase.expectedError) {
      console.log(`  OK: Error occurred as expected`);
    } else {
      console.log(`  ERROR: Unexpected error!`);
    }
  }
  console.log();
}

// Now test with toDecimal() wrapper - the new implementation
console.log('=== Testing FIXED implementation (with toDecimal wrapper) ===\n');

/**
 * toDecimal - Safe Decimal conversion that returns Decimal(NaN) for invalid values.
 * This is the new implementation requested in PR review.
 */
const toDecimal = (value: unknown, context?: string): Decimal => {
  try {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      // In verbose mode, this would log details about the invalid value
      console.log(
        `  [DEBUG] toDecimal received invalid value: context=${context}, type=${typeof value}, value=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`
      );
      return new Decimal(NaN);
    }
    return new Decimal(value);
  } catch (error) {
    console.warn(`  [WARN] toDecimal failed: ${(error as Error).message}`);
    return new Decimal(NaN);
  }
};

/**
 * safeTokenValue - Extract a safe numeric value from API response data.
 */
const safeTokenValue = (value: unknown, context: string): number => {
  if (value === undefined || value === null) {
    return 0;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  console.log(
    `  [DEBUG] Invalid token value: context=${context}, type=${typeof value}, value=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`
  );
  return 0;
};

function getUsageFixed(usage: {
  inputTokens?: unknown;
  outputTokens?: unknown;
  cachedInputTokens?: unknown;
  reasoningTokens?: unknown;
}) {
  const cachedInputTokens = safeTokenValue(
    usage.cachedInputTokens,
    'cachedInputTokens'
  );
  const rawInputTokens = safeTokenValue(usage.inputTokens, 'inputTokens');
  const adjustedInputTokens = rawInputTokens - cachedInputTokens;

  const tokens = {
    input: Math.max(0, adjustedInputTokens),
    output: safeTokenValue(usage.outputTokens, 'outputTokens'),
    reasoning: safeTokenValue(usage.reasoningTokens, 'reasoningTokens'),
    cache: {
      write: 0,
      read: cachedInputTokens,
    },
  };

  // Use toDecimal for safe Decimal construction
  const costDecimal = toDecimal(0, 'cost_base')
    .add(
      toDecimal(tokens.input, 'tokens.input')
        .mul(toDecimal(0.003, 'rate.input'))
        .div(1_000_000)
    )
    .add(
      toDecimal(tokens.output, 'tokens.output')
        .mul(toDecimal(0.015, 'rate.output'))
        .div(1_000_000)
    );

  // Convert to number, defaulting to 0 if result is NaN
  const cost = costDecimal.isNaN() ? 0 : costDecimal.toNumber();

  return { cost, tokens };
}

for (const testCase of testCases) {
  console.log(`Test: ${testCase.name}`);
  console.log(`  Input: ${JSON.stringify(testCase.usage)}`);

  try {
    const result = getUsageFixed(testCase.usage as any);
    console.log(`  Result: ${JSON.stringify(result)}`);
    console.log(`  OK: Completed without crash`);
  } catch (error) {
    console.log(`  Exception: ${(error as Error).message}`);
    console.log(`  ERROR: Still crashed with fix!`);
  }
  console.log();
}

console.log('=== Experiment Complete ===');
console.log('\nKey improvements in the new implementation:');
console.log('1. toDecimal() returns Decimal(NaN) instead of crashing');
console.log(
  '2. Debug logging shows exact values when invalid data is received'
);
console.log('3. safeTokenValue() converts invalid token values to 0');
console.log('4. Final cost calculation handles NaN by returning 0');
