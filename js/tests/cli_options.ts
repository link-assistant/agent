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

  test('json_standard_default', async () => {
    const argv = await parseRunOptions([]);
    expect(argv.jsonStandard).toBe('opencode');
  });

  test('json_standard_claude', async () => {
    const argv = await parseRunOptions(['--json-standard', 'claude']);
    expect(argv.jsonStandard).toBe('claude');
  });

  test('input_format_default', async () => {
    const argv = await parseRunOptions([]);
    expect(argv.inputFormat).toBe('text');
  });

  test('input_format_stream_json', async () => {
    const argv = await parseRunOptions(['--input-format', 'stream-json']);
    expect(argv.inputFormat).toBe('stream-json');
  });

  test('input_format_rejects_invalid', async () => {
    await expect(parseRunOptions(['--input-format', 'json'])).rejects.toThrow(
      'Invalid values'
    );
  });

  test('output_format_stream_json_maps_to_claude', async () => {
    const argv = await parseRunOptions(['--output-format', 'stream-json']);
    expect(argv.outputFormat).toBe('stream-json');
    expect(argv.jsonStandard).toBe('claude');
  });

  test('output_format_json_maps_to_opencode', async () => {
    const argv = await parseRunOptions([
      '--json-standard',
      'claude',
      '--output-format',
      'json',
    ]);
    expect(argv.outputFormat).toBe('json');
    expect(argv.jsonStandard).toBe('opencode');
  });

  test('json_standard_rejects_invalid', async () => {
    await expect(parseRunOptions(['--json-standard', 'xml'])).rejects.toThrow(
      'Invalid values'
    );
  });

  test('system_message_option', async () => {
    const argv = await parseRunOptions([
      '--system-message',
      'You are a test bot',
    ]);
    expect(argv.systemMessage).toBe('You are a test bot');
  });

  test('system_message_file_option', async () => {
    const argv = await parseRunOptions([
      '--system-message-file',
      '/tmp/sys.txt',
    ]);
    expect(argv.systemMessageFile).toBe('/tmp/sys.txt');
  });

  test('append_system_message_option', async () => {
    const argv = await parseRunOptions([
      '--append-system-message',
      'Extra instructions',
    ]);
    expect(argv.appendSystemMessage).toBe('Extra instructions');
  });

  test('append_system_message_file_option', async () => {
    const argv = await parseRunOptions([
      '--append-system-message-file',
      '/tmp/append.txt',
    ]);
    expect(argv.appendSystemMessageFile).toBe('/tmp/append.txt');
  });

  test('system_message_file_not_found', async () => {
    const argv = await parseRunOptions([
      '--system-message-file',
      '/tmp/nonexistent_file_12345.txt',
    ]);
    expect(argv.systemMessageFile).toBe('/tmp/nonexistent_file_12345.txt');
  });

  test('server_mode_default_true', async () => {
    const argv = await parseRunOptions([]);
    expect(argv.server).toBe(true);
  });

  test('server_mode_disabled', async () => {
    const argv = await parseRunOptions(['--no-server']);
    expect(argv.server).toBe(false);
  });

  test('verbose_shows_config', async () => {
    const argv = await parseRunOptions(['--verbose']);
    expect(argv.verbose).toBe(true);
    expect(argv.model).toBe('opencode/minimax-m2.5-free');
    expect(argv.jsonStandard).toBe('opencode');
    expect(argv.compactionModel).toBe('opencode/gpt-5-nano');
    expect(argv.compactionSafetyMargin).toBe(25);
  });

  test('verbose_off_hides_config', async () => {
    const argv = await parseRunOptions([]);
    expect(argv.verbose).toBe(false);
  });

  test('dry_run_echoes_message', async () => {
    const argv = await parseRunOptions(['--dry-run', '-p', 'test message']);
    expect(argv.dryRun).toBe(true);
    expect(argv.prompt).toBe('test message');
  });

  test('use_existing_claude_oauth_accepted', async () => {
    const argv = await parseRunOptions(['--use-existing-claude-oauth']);
    expect(argv.useExistingClaudeOauth).toBe(true);
  });

  test('prompt_short_flag', async () => {
    const argv = await parseRunOptions(['-p', 'short flag test']);
    expect(argv.prompt).toBe('short flag test');
  });

  test('prompt_long_flag', async () => {
    const argv = await parseRunOptions(['--prompt', 'long flag test']);
    expect(argv.prompt).toBe('long flag test');
  });

  test('disable_stdin_with_prompt_succeeds', async () => {
    const argv = await parseRunOptions(['--disable-stdin', '-p', 'hello']);
    expect(argv.disableStdin).toBe(true);
    expect(argv.prompt).toBe('hello');
  });

  test('disable_stdin_without_prompt_fails', async () => {
    const argv = await parseRunOptions(['--disable-stdin']);
    expect(argv.disableStdin).toBe(true);
    expect(argv.prompt).toBeUndefined();
  });

  test('stdin_stream_timeout_accepted', async () => {
    const argv = await parseRunOptions([
      '--stdin-stream-timeout',
      '5000',
      '-p',
      'hello',
    ]);
    expect(argv.stdinStreamTimeout).toBe(5000);
  });

  test('auto_merge_queued_messages_default', async () => {
    const argv = await parseRunOptions([]);
    expect(argv.autoMergeQueuedMessages).toBe(true);
  });

  test('no_auto_merge_queued_messages', async () => {
    const argv = await parseRunOptions(['--no-auto-merge-queued-messages']);
    expect(argv.autoMergeQueuedMessages).toBe(false);
  });

  test('interactive_default_true', async () => {
    const argv = await parseRunOptions([]);
    expect(argv.interactive).toBe(true);
  });

  test('no_interactive', async () => {
    const argv = await parseRunOptions(['--no-interactive']);
    expect(argv.interactive).toBe(false);
  });

  test('no_always_accept_stdin', async () => {
    const argv = await parseRunOptions(['--no-always-accept-stdin']);
    expect(argv.alwaysAcceptStdin).toBe(false);
  });

  test('compact_json_single_line', async () => {
    const argv = await parseRunOptions(['--compact-json']);
    expect(argv.compactJson).toBe(true);
  });

  test('resume_option_accepted', async () => {
    const argv = await parseRunOptions(['--resume', 'ses_abc123']);
    expect(argv.resume).toBe('ses_abc123');
  });

  test('resume_short_flag', async () => {
    const argv = await parseRunOptions(['-r', 'ses_abc123']);
    expect(argv.resume).toBe('ses_abc123');
  });

  test('continue_option_accepted', async () => {
    const argv = await parseRunOptions(['--continue']);
    expect(argv.continue).toBe(true);
  });

  test('continue_short_flag', async () => {
    const argv = await parseRunOptions(['-c']);
    expect(argv.continue).toBe(true);
  });

  test('no_fork_option_accepted', async () => {
    const argv = await parseRunOptions([
      '--no-fork',
      '--resume',
      'ses_abc',
      '-p',
      'hello',
    ]);
    expect(argv.noFork).toBe(true);
  });

  test('generate_title_option', async () => {
    const argv = await parseRunOptions(['--generate-title']);
    expect(argv.generateTitle).toBe(true);
  });

  test('retry_timeout_option', async () => {
    const argv = await parseRunOptions(['--retry-timeout', '3600']);
    expect(argv.retryTimeout).toBe(3600);
  });

  test('retry_on_rate_limits_default_true', async () => {
    const argv = await parseRunOptions([]);
    expect(argv.retryOnRateLimits).toBe(true);
  });

  test('no_retry_on_rate_limits', async () => {
    const argv = await parseRunOptions(['--no-retry-on-rate-limits']);
    expect(argv.retryOnRateLimits).toBe(false);
  });

  test('output_response_model_accepted', async () => {
    const argv = await parseRunOptions(['--no-output-response-model']);
    expect(argv.outputResponseModel).toBe(false);
  });

  test('summarize_session_default', async () => {
    const argv = await parseRunOptions([]);
    expect(argv.summarizeSession).toBe(true);
  });

  test('no_summarize_session', async () => {
    const argv = await parseRunOptions(['--no-summarize-session']);
    expect(argv.summarizeSession).toBe(false);
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

  test('all_options_accepted_together', async () => {
    const argv = await parseRunOptions([
      '--model',
      'opencode/gpt-5',
      '--json-standard',
      'claude',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--system-message',
      'Be helpful',
      '--verbose',
      '--dry-run',
      '--use-existing-claude-oauth',
      '--compact-json',
      '--no-interactive',
      '--no-always-accept-stdin',
      '--no-auto-merge-queued-messages',
      '--generate-title',
      '--no-retry-on-rate-limits',
      '--retry-timeout',
      '60',
      '--no-output-response-model',
      '--no-summarize-session',
      '--compaction-model',
      'same',
      '--compaction-models',
      '(same)',
      '--compaction-safety-margin',
      '20',
      '--temperature',
      '0.5',
      '--no-server',
      '--no-fork',
      '--resume',
      'ses_abc',
      '--stdin-stream-timeout',
      '1000',
      '--disable-stdin',
      '-p',
      'test',
    ]);

    expect(argv.model).toBe('opencode/gpt-5');
    expect(argv.jsonStandard).toBe('claude');
    expect(argv.inputFormat).toBe('stream-json');
    expect(argv.outputFormat).toBe('stream-json');
    expect(argv.systemMessage).toBe('Be helpful');
    expect(argv.verbose).toBe(true);
    expect(argv.dryRun).toBe(true);
    expect(argv.useExistingClaudeOauth).toBe(true);
    expect(argv.compactJson).toBe(true);
    expect(argv.interactive).toBe(false);
    expect(argv.alwaysAcceptStdin).toBe(false);
    expect(argv.autoMergeQueuedMessages).toBe(false);
    expect(argv.generateTitle).toBe(true);
    expect(argv.retryOnRateLimits).toBe(false);
    expect(argv.retryTimeout).toBe(60);
    expect(argv.outputResponseModel).toBe(false);
    expect(argv.summarizeSession).toBe(false);
    expect(argv.compactionModel).toBe('same');
    expect(argv.compactionModels).toBe('(same)');
    expect(argv.compactionSafetyMargin).toBe(20);
    expect(argv.temperature).toBe(0.5);
    expect(argv.server).toBe(false);
    expect(argv.noFork).toBe(true);
    expect(argv.resume).toBe('ses_abc');
    expect(argv.stdinStreamTimeout).toBe(1000);
    expect(argv.disableStdin).toBe(true);
    expect(argv.prompt).toBe('test');
  });
});
