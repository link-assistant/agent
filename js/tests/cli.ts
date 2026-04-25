import { describe, expect, test } from 'bun:test';
import yargs from 'yargs';
import { buildRunOptions } from '../src/cli/run-options.js';
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

async function parseArgs(
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

describe('cli', () => {
  test('test_parse_json_input', () => {
    const input = '{"message": "hello world"}';
    const msg = JSON.parse(input);
    expect(msg.message).toBe('hello world');
  });

  test('test_args_defaults', async () => {
    const args = await parseArgs([]);
    expect(args.model).toBe(DEFAULT_MODEL);
    expect(args.jsonStandard).toBe('opencode');
    expect(args.server).toBe(true);
    expect(args.verbose).toBe(false);
    expect(args.dryRun).toBe(false);
    expect(args.useExistingClaudeOauth).toBe(false);
    expect(args.prompt).toBeUndefined();
    expect(args.disableStdin).toBe(false);
    expect(args.stdinStreamTimeout).toBeUndefined();
    expect(args.autoMergeQueuedMessages).toBe(true);
    expect(args.interactive).toBe(true);
    expect(args.alwaysAcceptStdin).toBe(true);
    expect(args.compactJson).toBe(false);
    expect(args.resume).toBeUndefined();
    expect(args.continue).toBe(false);
    expect(args.noFork).toBe(false);
    expect(args.generateTitle).toBe(false);
    expect(args.retryTimeout).toBeUndefined();
    expect(args.retryOnRateLimits).toBe(true);
    expect(args.outputResponseModel).toBe(true);
    expect(args.summarizeSession).toBe(true);
    expect(args.compactionModel).toBe(DEFAULT_COMPACTION_MODEL);
    expect(args.compactionModels).toBe(DEFAULT_COMPACTION_MODELS);
    expect(args.compactionSafetyMargin).toBe(
      DEFAULT_COMPACTION_SAFETY_MARGIN_PERCENT
    );
    expect(args.temperature).toBeUndefined();
    expect(args.systemMessage).toBeUndefined();
    expect(args.systemMessageFile).toBeUndefined();
    expect(args.appendSystemMessage).toBeUndefined();
    expect(args.appendSystemMessageFile).toBeUndefined();
    expect(args.workingDirectory).toBeUndefined();
  });

  test('test_args_with_prompt', async () => {
    const args = await parseArgs(['-p', 'hello']);
    expect(args.prompt).toBe('hello');
  });

  test('test_args_temperature_not_set', async () => {
    const args = await parseArgs([]);
    expect(args.temperature).toBeUndefined();
  });

  test('test_args_temperature_float', async () => {
    const args = await parseArgs(['--temperature', '0.7']);
    expect(args.temperature).toBe(0.7);
  });

  test('test_args_temperature_zero', async () => {
    const args = await parseArgs(['--temperature', '0']);
    expect(args.temperature).toBe(0);
  });

  test('test_args_temperature_one', async () => {
    const args = await parseArgs(['--temperature', '1.0']);
    expect(args.temperature).toBe(1);
  });

  test('test_args_temperature_with_prompt', async () => {
    const args = await parseArgs(['--temperature', '0.5', '-p', 'hello']);
    expect(args.temperature).toBe(0.5);
    expect(args.prompt).toBe('hello');
  });

  test('test_args_model', async () => {
    const args = await parseArgs(['--model', 'opencode/gpt-5']);
    expect(args.model).toBe('opencode/gpt-5');
  });

  test('test_args_json_standard_claude', async () => {
    const args = await parseArgs(['--json-standard', 'claude']);
    expect(args.jsonStandard).toBe('claude');
  });

  test('test_args_system_message', async () => {
    const args = await parseArgs(['--system-message', 'You are helpful']);
    expect(args.systemMessage).toBe('You are helpful');
  });

  test('test_args_system_message_file', async () => {
    const args = await parseArgs(['--system-message-file', '/tmp/sys.txt']);
    expect(args.systemMessageFile).toBe('/tmp/sys.txt');
  });

  test('test_args_append_system_message', async () => {
    const args = await parseArgs([
      '--append-system-message',
      'extra instructions',
    ]);
    expect(args.appendSystemMessage).toBe('extra instructions');
  });

  test('test_args_append_system_message_file', async () => {
    const args = await parseArgs([
      '--append-system-message-file',
      '/tmp/append.txt',
    ]);
    expect(args.appendSystemMessageFile).toBe('/tmp/append.txt');
  });

  test('test_args_server_mode', async () => {
    const args = await parseArgs([]);
    expect(args.server).toBe(true);
  });

  test('test_args_no_server', async () => {
    const args = await parseArgs(['--no-server']);
    expect(args.server).toBe(false);
  });

  test('test_args_verbose', async () => {
    const args = await parseArgs(['--verbose']);
    expect(args.verbose).toBe(true);
  });

  test('test_args_dry_run', async () => {
    const args = await parseArgs(['--dry-run']);
    expect(args.dryRun).toBe(true);
  });

  test('test_args_use_existing_claude_oauth', async () => {
    const args = await parseArgs(['--use-existing-claude-oauth']);
    expect(args.useExistingClaudeOauth).toBe(true);
  });

  test('test_args_disable_stdin', async () => {
    const args = await parseArgs(['--disable-stdin', '-p', 'test']);
    expect(args.disableStdin).toBe(true);
  });

  test('test_args_stdin_stream_timeout', async () => {
    const args = await parseArgs(['--stdin-stream-timeout', '5000']);
    expect(args.stdinStreamTimeout).toBe(5000);
  });

  test('test_args_no_auto_merge_queued_messages', async () => {
    const args = await parseArgs(['--no-auto-merge-queued-messages']);
    expect(args.autoMergeQueuedMessages).toBe(false);
  });

  test('test_args_no_interactive', async () => {
    const args = await parseArgs(['--no-interactive']);
    expect(args.interactive).toBe(false);
  });

  test('test_args_no_always_accept_stdin', async () => {
    const args = await parseArgs(['--no-always-accept-stdin']);
    expect(args.alwaysAcceptStdin).toBe(false);
  });

  test('test_args_compact_json', async () => {
    const args = await parseArgs(['--compact-json']);
    expect(args.compactJson).toBe(true);
  });

  test('test_args_resume', async () => {
    const args = await parseArgs(['--resume', 'ses_abc123']);
    expect(args.resume).toBe('ses_abc123');
  });

  test('test_args_resume_short', async () => {
    const args = await parseArgs(['-r', 'ses_abc123']);
    expect(args.resume).toBe('ses_abc123');
  });

  test('test_args_continue', async () => {
    const args = await parseArgs(['--continue']);
    expect(args.continue).toBe(true);
  });

  test('test_args_continue_short', async () => {
    const args = await parseArgs(['-c']);
    expect(args.continue).toBe(true);
  });

  test('test_args_no_fork', async () => {
    const args = await parseArgs(['--no-fork', '--resume', 'ses_abc']);
    expect(args.noFork).toBe(true);
  });

  test('test_args_generate_title', async () => {
    const args = await parseArgs(['--generate-title']);
    expect(args.generateTitle).toBe(true);
  });

  test('test_args_retry_timeout', async () => {
    const args = await parseArgs(['--retry-timeout', '3600']);
    expect(args.retryTimeout).toBe(3600);
  });

  test('test_args_no_retry_on_rate_limits', async () => {
    const args = await parseArgs(['--no-retry-on-rate-limits']);
    expect(args.retryOnRateLimits).toBe(false);
  });

  test('test_args_no_output_response_model', async () => {
    const args = await parseArgs(['--no-output-response-model']);
    expect(args.outputResponseModel).toBe(false);
  });

  test('test_args_no_summarize_session', async () => {
    const args = await parseArgs(['--no-summarize-session']);
    expect(args.summarizeSession).toBe(false);
  });

  test('test_args_compaction_model', async () => {
    const args = await parseArgs(['--compaction-model', 'opencode/gpt-5']);
    expect(args.compactionModel).toBe('opencode/gpt-5');
  });

  test('test_args_compaction_models', async () => {
    const args = await parseArgs([
      '--compaction-models',
      '(model1 model2 same)',
    ]);
    expect(args.compactionModels).toBe('(model1 model2 same)');
  });

  test('test_args_compaction_safety_margin', async () => {
    const args = await parseArgs(['--compaction-safety-margin', '20']);
    expect(args.compactionSafetyMargin).toBe(20);
  });

  test('test_args_all_options_combined', async () => {
    const args = await parseArgs([
      '--model',
      'opencode/gpt-5',
      '--json-standard',
      'claude',
      '--system-message',
      'Be helpful',
      '--verbose',
      '--dry-run',
      '--compact-json',
      '--temperature',
      '0.8',
      '--compaction-model',
      'same',
      '--compaction-safety-margin',
      '10',
      '--no-interactive',
      '--no-always-accept-stdin',
      '--no-retry-on-rate-limits',
      '--retry-timeout',
      '60',
      '--generate-title',
      '--no-summarize-session',
      '-p',
      'test prompt',
    ]);

    expect(args.model).toBe('opencode/gpt-5');
    expect(args.jsonStandard).toBe('claude');
    expect(args.systemMessage).toBe('Be helpful');
    expect(args.verbose).toBe(true);
    expect(args.dryRun).toBe(true);
    expect(args.compactJson).toBe(true);
    expect(args.temperature).toBe(0.8);
    expect(args.compactionModel).toBe('same');
    expect(args.compactionSafetyMargin).toBe(10);
    expect(args.interactive).toBe(false);
    expect(args.alwaysAcceptStdin).toBe(false);
    expect(args.retryOnRateLimits).toBe(false);
    expect(args.retryTimeout).toBe(60);
    expect(args.generateTitle).toBe(true);
    expect(args.summarizeSession).toBe(false);
    expect(args.prompt).toBe('test prompt');
  });

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
