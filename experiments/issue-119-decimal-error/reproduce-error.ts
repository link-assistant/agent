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

// Now test with safe() wrapper
console.log('=== Testing FIXED implementation (with safe wrapper) ===\n');

const safe = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return value;
};

function getUsageFixed(usage: {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
}) {
  const cachedInputTokens = safe(usage.cachedInputTokens ?? 0);
  const adjustedInputTokens =
    safe(usage.inputTokens ?? 0) - cachedInputTokens;

  const tokens = {
    input: safe(adjustedInputTokens),
    output: safe(usage.outputTokens ?? 0),
    reasoning: safe(usage.reasoningTokens ?? 0),
    cache: {
      write: 0,
      read: safe(cachedInputTokens),
    },
  };

  try {
    const cost = safe(
      new Decimal(0)
        .add(new Decimal(tokens.input).mul(0.003).div(1_000_000))
        .add(new Decimal(tokens.output).mul(0.015).div(1_000_000))
        .toNumber()
    );

    return { cost, tokens };
  } catch (error) {
    console.warn('Failed to calculate cost:', error);
    return { cost: 0, tokens };
  }
}

for (const testCase of testCases) {
  console.log(`Test: ${testCase.name}`);
  console.log(`  Input: ${JSON.stringify(testCase.usage)}`);

  try {
    const result = getUsageFixed(testCase.usage);
    console.log(`  Result: ${JSON.stringify(result)}`);
    console.log(`  OK: Completed without crash`);
  } catch (error) {
    console.log(`  Exception: ${(error as Error).message}`);
    console.log(`  ERROR: Still crashed with fix!`);
  }
  console.log();
}

console.log('=== Experiment Complete ===');
