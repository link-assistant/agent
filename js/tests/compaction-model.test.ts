import { test, expect, describe } from 'bun:test';

/**
 * Unit tests for compaction model and safety margin logic.
 *
 * Issue #219: Add --compaction-model and set it to free gpt-5-nano by default
 *
 * Key behaviors:
 * 1. When compaction model has larger context than base model → no safety margin (ratio 1.0)
 * 2. When compaction model is "same" → apply configured safety margin
 * 3. When compaction model has equal or smaller context → apply configured safety margin
 * 4. Default safety margin is 25% (ratio 0.75) — lowered from 15% in #249
 * 5. Safety margin is configurable via --compaction-safety-margin
 * 6. When provider returns 0 tokens, estimatedInputTokens fallback is used
 *
 * @see https://github.com/link-assistant/agent/issues/219
 */

// Import the compaction module
import { SessionCompaction } from '../src/session/compaction';

describe('computeSafetyMarginRatio', () => {
  test('returns default 0.75 when no compaction model config', () => {
    const ratio = SessionCompaction.computeSafetyMarginRatio({
      baseModelContextLimit: 200_000,
    });
    expect(ratio).toBe(0.75);
  });

  test('returns 1.0 when compaction model has larger context than base model', () => {
    const ratio = SessionCompaction.computeSafetyMarginRatio({
      baseModelContextLimit: 200_000,
      compactionModel: {
        providerID: 'opencode',
        modelID: 'gpt-5-nano',
        useSameModel: false,
        compactionSafetyMarginPercent: 15,
      },
      compactionModelContextLimit: 400_000,
    });
    expect(ratio).toBe(1.0);
  });

  test('returns configured ratio when compaction model has equal context', () => {
    const ratio = SessionCompaction.computeSafetyMarginRatio({
      baseModelContextLimit: 200_000,
      compactionModel: {
        providerID: 'opencode',
        modelID: 'some-model',
        useSameModel: false,
        compactionSafetyMarginPercent: 25,
      },
      compactionModelContextLimit: 200_000,
    });
    expect(ratio).toBe(0.75);
  });

  test('returns configured ratio when compaction model has smaller context', () => {
    const ratio = SessionCompaction.computeSafetyMarginRatio({
      baseModelContextLimit: 400_000,
      compactionModel: {
        providerID: 'opencode',
        modelID: 'some-model',
        useSameModel: false,
        compactionSafetyMarginPercent: 20,
      },
      compactionModelContextLimit: 200_000,
    });
    expect(ratio).toBe(0.8);
  });

  test('always applies configured ratio when useSameModel is true', () => {
    // Even if compaction model context is larger (which shouldn't happen with same model,
    // but guards against edge cases)
    const ratio = SessionCompaction.computeSafetyMarginRatio({
      baseModelContextLimit: 200_000,
      compactionModel: {
        providerID: 'opencode',
        modelID: 'minimax-m2.5-free',
        useSameModel: true,
        compactionSafetyMarginPercent: 25,
      },
      compactionModelContextLimit: 400_000,
    });
    expect(ratio).toBe(0.75);
  });

  test('supports custom safety margin percentage', () => {
    const ratio = SessionCompaction.computeSafetyMarginRatio({
      baseModelContextLimit: 200_000,
      compactionModel: {
        providerID: 'opencode',
        modelID: 'minimax-m2.5-free',
        useSameModel: true,
        compactionSafetyMarginPercent: 10,
      },
    });
    expect(ratio).toBe(0.9);
  });

  test('0% safety margin gives ratio 1.0', () => {
    const ratio = SessionCompaction.computeSafetyMarginRatio({
      baseModelContextLimit: 200_000,
      compactionModel: {
        providerID: 'opencode',
        modelID: 'minimax-m2.5-free',
        useSameModel: true,
        compactionSafetyMarginPercent: 0,
      },
    });
    expect(ratio).toBe(1.0);
  });

  test('falls back to configured ratio when compaction model context limit is 0', () => {
    const ratio = SessionCompaction.computeSafetyMarginRatio({
      baseModelContextLimit: 200_000,
      compactionModel: {
        providerID: 'opencode',
        modelID: 'gpt-5-nano',
        useSameModel: false,
        compactionSafetyMarginPercent: 25,
      },
      compactionModelContextLimit: 0,
    });
    expect(ratio).toBe(0.75);
  });

  test('falls back to configured ratio when compaction model context limit is undefined', () => {
    const ratio = SessionCompaction.computeSafetyMarginRatio({
      baseModelContextLimit: 200_000,
      compactionModel: {
        providerID: 'opencode',
        modelID: 'gpt-5-nano',
        useSameModel: false,
        compactionSafetyMarginPercent: 25,
      },
    });
    expect(ratio).toBe(0.75);
  });
});

describe('isOverflow with compaction model', () => {
  const baseModel = {
    id: 'minimax-m2.5-free',
    name: 'Minimax M2.5 Free',
    release_date: '2025-01-01',
    attachment: false,
    reasoning: false,
    temperature: false,
    tool_call: true,
    cost: { input: 0, output: 0 },
    limit: { context: 200_000, output: 32_000 },
    options: {},
  };

  const tokens = {
    input: 140_000,
    output: 5_000,
    reasoning: 0,
    cache: { read: 0, write: 0 },
  };

  test('overflows with default safety margin at 75% of usable context', () => {
    // usable = 200000 - 32000 = 168000
    // safeLimit = 168000 * 0.75 = 126000
    // tokens = 140000 + 0 + 5000 = 145000 > 126000 → overflow
    const overflow = SessionCompaction.isOverflow({
      tokens,
      model: baseModel as any,
    });
    expect(overflow).toBe(true);
  });

  test('does NOT overflow when compaction model has larger context (ratio 1.0)', () => {
    // usable = 200000 - 32000 = 168000
    // safeLimit = 168000 * 1.0 = 168000
    // tokens = 145000 < 168000 → no overflow
    const overflow = SessionCompaction.isOverflow({
      tokens,
      model: baseModel as any,
      compactionModel: {
        providerID: 'opencode',
        modelID: 'gpt-5-nano',
        useSameModel: false,
        compactionSafetyMarginPercent: 25,
      },
      compactionModelContextLimit: 400_000,
    });
    expect(overflow).toBe(false);
  });

  test('overflows even with larger compaction model when tokens exceed usable context', () => {
    // usable = 200000 - 32000 = 168000
    // safeLimit = 168000 * 1.0 = 168000
    // tokens = 170000 > 168000 → overflow
    const highTokens = { ...tokens, input: 165_000 };
    const overflow = SessionCompaction.isOverflow({
      tokens: highTokens,
      model: baseModel as any,
      compactionModel: {
        providerID: 'opencode',
        modelID: 'gpt-5-nano',
        useSameModel: false,
        compactionSafetyMarginPercent: 25,
      },
      compactionModelContextLimit: 400_000,
    });
    expect(overflow).toBe(true);
  });

  test('uses estimatedInputTokens when provider returns 0 tokens', () => {
    // When provider returns all zeros, use estimated tokens
    // usable = 200000 - 32000 = 168000
    // safeLimit = 168000 * 0.75 = 126000 (default ratio without compaction model)
    // estimatedInputTokens = 130000 > 126000 → overflow
    const zeroTokens = {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    };
    const overflow = SessionCompaction.isOverflow({
      tokens: zeroTokens,
      model: baseModel as any,
      estimatedInputTokens: 130_000,
    });
    expect(overflow).toBe(true);
  });

  test('does NOT use estimatedInputTokens when provider returns non-zero tokens', () => {
    // When provider returns valid tokens, use them even if below threshold
    // usable = 200000 - 32000 = 168000
    // safeLimit = 168000 * 0.75 = 126000
    // providerTokens = 50000 + 0 + 5000 = 55000 < 126000 → no overflow
    // estimatedInputTokens = 200000 would cause overflow if used, but should be ignored
    const lowTokens = {
      input: 50_000,
      output: 5_000,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    };
    const overflow = SessionCompaction.isOverflow({
      tokens: lowTokens,
      model: baseModel as any,
      estimatedInputTokens: 200_000,
    });
    expect(overflow).toBe(false);
  });

  test('does NOT overflow with 0 tokens and no estimate', () => {
    const zeroTokens = {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    };
    const overflow = SessionCompaction.isOverflow({
      tokens: zeroTokens,
      model: baseModel as any,
    });
    expect(overflow).toBe(false);
  });
});

describe('contextDiagnostics with compaction model', () => {
  const baseModel = {
    id: 'minimax-m2.5-free',
    name: 'Minimax M2.5 Free',
    release_date: '2025-01-01',
    attachment: false,
    reasoning: false,
    temperature: false,
    tool_call: true,
    cost: { input: 0, output: 0 },
    limit: { context: 200_000, output: 32_000 },
    options: {},
  };

  test('uses default safety margin without compaction model config', () => {
    const diag = SessionCompaction.contextDiagnostics({
      tokens: { input: 100_000, output: 5_000, cache: { read: 0 } },
      model: baseModel as any,
    });
    expect(diag).toBeDefined();
    expect(diag!.safetyMargin).toBe(0.75);
    expect(diag!.safeLimit).toBe(Math.floor(168_000 * 0.75));
  });

  test('uses 1.0 ratio when compaction model has larger context', () => {
    const diag = SessionCompaction.contextDiagnostics({
      tokens: { input: 100_000, output: 5_000, cache: { read: 0 } },
      model: baseModel as any,
      compactionModel: {
        providerID: 'opencode',
        modelID: 'gpt-5-nano',
        useSameModel: false,
        compactionSafetyMarginPercent: 25,
      },
      compactionModelContextLimit: 400_000,
    });
    expect(diag).toBeDefined();
    expect(diag!.safetyMargin).toBe(1.0);
    expect(diag!.safeLimit).toBe(168_000);
  });
});

describe('argv parsing', () => {
  test('getCompactionModelFromProcessArgv returns null when not set', async () => {
    const { getCompactionModelFromProcessArgv } =
      await import('../src/cli/argv');
    // No --compaction-model in process.argv
    const result = getCompactionModelFromProcessArgv();
    expect(result).toBe(null);
  });

  test('getCompactionSafetyMarginFromProcessArgv returns null when not set', async () => {
    const { getCompactionSafetyMarginFromProcessArgv } =
      await import('../src/cli/argv');
    const result = getCompactionSafetyMarginFromProcessArgv();
    expect(result).toBe(null);
  });

  test('getCompactionModelsFromProcessArgv returns null when not set', async () => {
    const { getCompactionModelsFromProcessArgv } =
      await import('../src/cli/argv');
    const result = getCompactionModelsFromProcessArgv();
    expect(result).toBe(null);
  });
});

describe('CompactionModelConfig with cascade', () => {
  test('CompactionModelConfig supports compactionModels array', () => {
    const config: SessionCompaction.CompactionModelConfig = {
      providerID: 'opencode',
      modelID: 'big-pickle',
      useSameModel: false,
      compactionSafetyMarginPercent: 25,
      compactionModels: [
        { providerID: 'opencode', modelID: 'big-pickle', useSameModel: false },
        {
          providerID: 'opencode',
          modelID: 'nemotron-3-super-free',
          useSameModel: false,
        },
        {
          providerID: 'opencode',
          modelID: 'minimax-m2.5-free',
          useSameModel: false,
        },
        { providerID: 'opencode', modelID: 'gpt-5-nano', useSameModel: false },
        {
          providerID: 'opencode',
          modelID: 'minimax-m2.5-free',
          useSameModel: true,
        },
      ],
    };
    expect(config.compactionModels).toBeDefined();
    expect(config.compactionModels!.length).toBe(5);
    expect(config.compactionModels![0].modelID).toBe('big-pickle');
    expect(config.compactionModels![4].useSameModel).toBe(true);
  });

  test('CompactionModelConfig backward compat without compactionModels', () => {
    const config: SessionCompaction.CompactionModelConfig = {
      providerID: 'opencode',
      modelID: 'gpt-5-nano',
      useSameModel: false,
      compactionSafetyMarginPercent: 25,
    };
    expect(config.compactionModels).toBeUndefined();
  });
});
