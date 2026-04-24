import {
  getDefaultModel,
  getDefaultCompactionModel,
  getDefaultCompactionModels,
  getDefaultCompactionSafetyMarginPercent,
} from './defaults.ts';

/**
 * Yargs builder for the default `run` command options.
 * Extracted from index.js to keep file size under 1000 lines.
 */
export function buildRunOptions(yargs, defaultOptions = {}) {
  const defaultModel = getDefaultModel(defaultOptions);
  const defaultCompactionModel = getDefaultCompactionModel(defaultOptions);
  const defaultCompactionModels = getDefaultCompactionModels(defaultOptions);
  const defaultCompactionSafetyMarginPercent =
    getDefaultCompactionSafetyMarginPercent(defaultOptions);

  const parser = yargs
    .option('model', {
      type: 'string',
      description: 'Model to use in format providerID/modelID',
      default: defaultModel,
    })
    .option('json-standard', {
      type: 'string',
      description:
        'JSON output format standard: "opencode" (default) or "claude" (experimental)',
      default: 'opencode',
      choices: ['opencode', 'claude'],
    })
    .option('system-message', {
      type: 'string',
      description: 'Full override of the system message',
    })
    .option('system-message-file', {
      type: 'string',
      description: 'Full override of the system message from file',
    })
    .option('append-system-message', {
      type: 'string',
      description: 'Append to the default system message',
    })
    .option('append-system-message-file', {
      type: 'string',
      description: 'Append to the default system message from file',
    })
    .option('server', {
      type: 'boolean',
      description: 'Run in server mode (default)',
      default: true,
    })
    .option('verbose', {
      type: 'boolean',
      description:
        'Enable verbose mode to debug API requests (shows system prompt, token counts, etc.)',
      default: false,
    })
    .option('dry-run', {
      type: 'boolean',
      description:
        'Simulate operations without making actual API calls or package installations (useful for testing)',
      default: false,
    })
    .option('use-existing-claude-oauth', {
      type: 'boolean',
      description:
        'Use existing Claude OAuth credentials from ~/.claude/.credentials.json (from Claude Code CLI)',
      default: false,
    })
    .option('prompt', {
      alias: 'p',
      type: 'string',
      description: 'Prompt message to send directly (bypasses stdin reading)',
    })
    .option('disable-stdin', {
      type: 'boolean',
      description:
        'Disable stdin streaming mode (requires --prompt or shows help)',
      default: false,
    })
    .option('stdin-stream-timeout', {
      type: 'number',
      description:
        'Optional timeout in milliseconds for stdin reading (default: no timeout)',
    })
    .option('auto-merge-queued-messages', {
      type: 'boolean',
      description:
        'Enable auto-merging of rapidly arriving input lines into single messages (default: true)',
      default: true,
    })
    .option('interactive', {
      type: 'boolean',
      description:
        'Enable interactive mode to accept manual input as plain text strings (default: true). Use --no-interactive to only accept JSON input.',
      default: true,
    })
    .option('always-accept-stdin', {
      type: 'boolean',
      description:
        'Keep accepting stdin input even after the agent finishes work (default: true). Use --no-always-accept-stdin for single-message mode.',
      default: true,
    })
    .option('compact-json', {
      type: 'boolean',
      description:
        'Output compact JSON (single line) instead of pretty-printed JSON (default: false). Useful for program-to-program communication.',
      default: false,
    })
    .option('resume', {
      alias: 'r',
      type: 'string',
      description:
        'Resume a specific session by ID. By default, forks the session with a new UUID. Use --no-fork to continue in the same session.',
    })
    .option('continue', {
      alias: 'c',
      type: 'boolean',
      description:
        'Continue the most recent session. By default, forks the session with a new UUID. Use --no-fork to continue in the same session.',
      default: false,
    })
    .option('no-fork', {
      type: 'boolean',
      description:
        'When used with --resume or --continue, continue in the same session without forking to a new UUID.',
      default: false,
    });

  const normalizedParser =
    typeof parser.middleware === 'function'
      ? parser.middleware((argv) => {
          if (argv.fork === false) {
            argv['no-fork'] = true;
            argv.noFork = true;
          }
        }, true)
      : parser;

  return normalizedParser
    .option('generate-title', {
      type: 'boolean',
      description:
        'Generate session titles using AI (default: false). Disabling saves tokens and prevents rate limit issues.',
      default: false,
    })
    .option('retry-timeout', {
      type: 'number',
      description:
        'Maximum total retry time in seconds for rate limit errors (default: 604800 = 7 days)',
    })
    .option('retry-on-rate-limits', {
      type: 'boolean',
      description:
        'Retry AI completions API requests when rate limited (HTTP 429). Use --no-retry-on-rate-limits in integration tests to fail fast instead of waiting.',
      default: true,
    })
    .option('output-response-model', {
      type: 'boolean',
      description: 'Include model info in step_finish output',
      default: true,
    })
    .option('summarize-session', {
      type: 'boolean',
      description:
        'Generate AI session summaries (default: true). Use --no-summarize-session to disable.',
      default: true,
    })
    .option('compaction-model', {
      type: 'string',
      description:
        'Model to use for context compaction in format providerID/modelID. Use "same" to use the base model. Default: opencode/gpt-5-nano (free, 400K context). Overridden by --compaction-models if both are specified.',
      default: defaultCompactionModel,
    })
    .option('compaction-models', {
      type: 'string',
      description:
        'Ordered cascade of compaction models in links notation sequence format: "(model1 model2 ... same)". ' +
        "Models are tried from smallest/cheapest context to largest. If used context exceeds a model's limit or its rate limit is reached, the next model is tried. " +
        'The special value "same" uses the base model. Overrides --compaction-model when specified.',
      default: defaultCompactionModels,
    })
    .option('compaction-safety-margin', {
      type: 'number',
      description:
        'Safety margin (%) of usable context window before triggering compaction. Only applies when the compaction model has equal or smaller context than the base model. Default: 25.',
      default: defaultCompactionSafetyMarginPercent,
    })
    .option('temperature', {
      type: 'number',
      description:
        'Override the temperature for model completions. When not set, the default per-model temperature is used.',
    });
}
