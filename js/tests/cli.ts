import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_COMPACTION_MODEL,
  DEFAULT_COMPACTION_MODEL_ENV,
  DEFAULT_COMPACTION_MODELS,
  DEFAULT_COMPACTION_MODELS_ENV,
  DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT,
  DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT_ENV,
  DEFAULT_MODEL,
  DEFAULT_MODEL_ENV,
  getDefaultCompactionModel,
  getDefaultCompactionModels,
  getDefaultCompactionSafetyMarginPercent,
  getDefaultModel,
  getDefaultModelParts,
} from '../src/config/defaults';

describe('cli', () => {
  test('test_default_model_matches_js', () => {
    expect(DEFAULT_MODEL).toBe('opencode/minimax-m2.5-free');
  });

  test('test_default_compaction_model_matches_js', () => {
    expect(DEFAULT_COMPACTION_MODEL).toBe('opencode/gpt-5-nano');
  });

  test('test_default_compaction_models_matches_js', () => {
    expect(DEFAULT_COMPACTION_MODELS).toBe(
      '(big-pickle minimax-m2.5-free nemotron-3-super-free hy3-preview-free ling-2.6-flash-free gpt-5-nano same)'
    );
  });

  test('test_default_compaction_safety_margin_matches_js', () => {
    expect(DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT).toBe(25);
  });

  test('test_default_model_can_be_overridden_by_env_reader', () => {
    const model = getDefaultModel({
      env: { [DEFAULT_MODEL_ENV]: 'opencode/env-default-free' },
    });

    expect(model).toBe('opencode/env-default-free');
  });

  test('test_default_model_parts_are_importable_from_library', () => {
    const parts = getDefaultModelParts({
      env: { [DEFAULT_MODEL_ENV]: 'opencode/env-default-free' },
    });

    expect(parts.providerID).toBe('opencode');
    expect(parts.modelID).toBe('env-default-free');
  });

  test('test_default_compaction_values_can_be_overridden_by_env_reader', () => {
    const env = {
      [DEFAULT_COMPACTION_MODEL_ENV]: 'opencode/env-compact-free',
      [DEFAULT_COMPACTION_MODELS_ENV]: '(env-compact-free same)',
      [DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT_ENV]: '12',
    };

    expect(getDefaultCompactionModel({ env })).toBe(
      'opencode/env-compact-free'
    );
    expect(getDefaultCompactionModels({ env })).toBe('(env-compact-free same)');
    expect(getDefaultCompactionSafetyMarginPercent({ env })).toBe(12);
  });
});
