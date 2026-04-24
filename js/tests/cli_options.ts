import { describe, expect, test } from 'bun:test';
import yargs from 'yargs';
import { buildRunOptions } from '../src/cli/run-options.js';
import {
  DEFAULT_COMPACTION_MODEL_ENV,
  DEFAULT_COMPACTION_MODELS_ENV,
  DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT_ENV,
  DEFAULT_MODEL_ENV,
} from '../src/config/defaults';

const defaultEnvKeys = [
  DEFAULT_MODEL_ENV,
  DEFAULT_COMPACTION_MODEL_ENV,
  DEFAULT_COMPACTION_MODELS_ENV,
  DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT_ENV,
];

function testEnv(
  overrides: Record<string, string> = {}
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  for (const key of defaultEnvKeys) {
    delete env[key];
  }
  return { ...env, ...overrides };
}

async function parseRunOptions(
  args: string[],
  envOverrides: Record<string, string> = {}
): Promise<Record<string, any>> {
  const parser = buildRunOptions(yargs(args), {
    env: testEnv(envOverrides),
  })
    .scriptName('agent')
    .exitProcess(false)
    .help(false)
    .fail((message, error) => {
      throw error ?? new Error(message);
    });

  return (await parser.parse()) as Record<string, any>;
}

describe('cli_options', () => {
  test('model_option_default', async () => {
    const argv = await parseRunOptions([]);
    expect(argv.model).toBe('opencode/minimax-m2.5-free');
  });

  test('model_option_custom', async () => {
    const argv = await parseRunOptions(['--model', 'opencode/gpt-5']);
    expect(argv.model).toBe('opencode/gpt-5');
  });

  test('model_option_env_default', async () => {
    const argv = await parseRunOptions([], {
      [DEFAULT_MODEL_ENV]: 'opencode/env-default-free',
    });
    expect(argv.model).toBe('opencode/env-default-free');
  });

  test('model_option_cli_overrides_env_default', async () => {
    const argv = await parseRunOptions(['--model', 'opencode/gpt-5'], {
      [DEFAULT_MODEL_ENV]: 'opencode/env-default-free',
    });
    expect(argv.model).toBe('opencode/gpt-5');
  });

  test('compaction_model_default', async () => {
    const argv = await parseRunOptions([]);
    expect(argv.compactionModel).toBe('opencode/gpt-5-nano');
  });

  test('compaction_model_custom', async () => {
    const argv = await parseRunOptions(['--compaction-model', 'same']);
    expect(argv.compactionModel).toBe('same');
  });

  test('compaction_model_env_default', async () => {
    const argv = await parseRunOptions([], {
      [DEFAULT_COMPACTION_MODEL_ENV]: 'opencode/env-compact-free',
    });
    expect(argv.compactionModel).toBe('opencode/env-compact-free');
  });

  test('compaction_model_cli_overrides_env_default', async () => {
    const argv = await parseRunOptions(['--compaction-model', 'same'], {
      [DEFAULT_COMPACTION_MODEL_ENV]: 'opencode/env-compact-free',
    });
    expect(argv.compactionModel).toBe('same');
  });

  test('compaction_models_default', async () => {
    const argv = await parseRunOptions([]);
    expect(argv.compactionModels).toBe(
      '(big-pickle minimax-m2.5-free nemotron-3-super-free hy3-preview-free ling-2.6-flash-free gpt-5-nano same)'
    );
  });

  test('compaction_models_custom', async () => {
    const argv = await parseRunOptions([
      '--compaction-models',
      '(model1 same)',
    ]);
    expect(argv.compactionModels).toBe('(model1 same)');
  });

  test('compaction_models_env_default', async () => {
    const argv = await parseRunOptions([], {
      [DEFAULT_COMPACTION_MODELS_ENV]: '(env-compact-free same)',
    });
    expect(argv.compactionModels).toBe('(env-compact-free same)');
  });

  test('compaction_models_cli_overrides_env_default', async () => {
    const argv = await parseRunOptions(
      ['--compaction-models', '(model1 same)'],
      { [DEFAULT_COMPACTION_MODELS_ENV]: '(env-compact-free same)' }
    );
    expect(argv.compactionModels).toBe('(model1 same)');
  });

  test('compaction_safety_margin_default', async () => {
    const argv = await parseRunOptions([]);
    expect(argv.compactionSafetyMargin).toBe(25);
  });

  test('compaction_safety_margin_custom', async () => {
    const argv = await parseRunOptions(['--compaction-safety-margin', '25']);
    expect(argv.compactionSafetyMargin).toBe(25);
  });

  test('compaction_safety_margin_env_default', async () => {
    const argv = await parseRunOptions([], {
      [DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT_ENV]: '12',
    });
    expect(argv.compactionSafetyMargin).toBe(12);
  });

  test('compaction_safety_margin_cli_overrides_env_default', async () => {
    const argv = await parseRunOptions(['--compaction-safety-margin', '25'], {
      [DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT_ENV]: '12',
    });
    expect(argv.compactionSafetyMargin).toBe(25);
  });
});
