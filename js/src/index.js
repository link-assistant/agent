#!/usr/bin/env bun
import { Flag } from './flag/flag.ts';
import { setProcessName } from './cli/process-name.ts';
setProcessName('agent');
import { Server } from './server/server.ts';
import { Instance } from './project/instance.ts';
import { Log } from './util/log.ts';
import { parseModelConfig } from './cli/model-config.js';
// Bus is used via createBusEventSubscription in event-handler.js
import { Session } from './session/index.ts';
import { SessionPrompt } from './session/prompt.ts';
// EOL is reserved for future use
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import {
  createEventHandler,
  isValidJsonStandard,
} from './json-standard/index.ts';
import { McpCommand } from './cli/cmd/mcp.ts';
import { AuthCommand } from './cli/cmd/auth.ts';
import { FormatError } from './cli/error.ts';
import { UI } from './cli/ui.ts';
import {
  runContinuousServerMode,
  runContinuousDirectMode,
  resolveResumeSession,
} from './cli/continuous-mode.js';
import { createBusEventSubscription } from './cli/event-handler.js';
import {
  outputStatus,
  outputError,
  outputHelp,
  setCompactJson,
  outputInput,
} from './cli/output.ts';
import stripAnsi from 'strip-ansi';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
let pkg;
try {
  pkg = require('../package.json');
} catch (_e) {
  // Fallback: read package.json directly
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkgPath = join(__dirname, '../package.json');
  const pkgContent = readFileSync(pkgPath, 'utf8');
  pkg = JSON.parse(pkgContent);
}

// Track if any errors occurred during execution
let hasError = false;

// Install global error handlers to ensure non-zero exit codes
// All output is JSON to ensure machine-parsability (#200)
process.on('uncaughtException', (error) => {
  hasError = true;
  try {
    outputError({
      errorType: error?.name || 'UncaughtException',
      message: error?.message || String(error),
      stack: error?.stack,
      ...(error?.cause ? { cause: String(error.cause) } : {}),
    });
  } catch (_serializationError) {
    // Last resort: write minimal JSON directly to stderr
    process.stderr.write(
      `${JSON.stringify({
        type: 'error',
        errorType: 'UncaughtException',
        message: String(error),
      })}\n`
    );
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason, _promise) => {
  hasError = true;
  try {
    const errorOutput = {
      errorType: 'UnhandledRejection',
      message: reason?.message || String(reason),
      stack: reason?.stack,
    };
    // If the error has a data property with a suggestion (e.g., ProviderModelNotFoundError), add it as a hint
    if (reason?.data?.suggestion) {
      errorOutput.hint = reason.data.suggestion;
    }
    // Include error data for debugging (#200)
    if (reason?.data) {
      errorOutput.data = reason.data;
    }
    outputError(errorOutput);
  } catch (_serializationError) {
    // Last resort: write minimal JSON directly to stderr
    process.stderr.write(
      `${JSON.stringify({
        type: 'error',
        errorType: 'UnhandledRejection',
        message: String(reason),
      })}\n`
    );
  }
  process.exit(1);
});

/**
 * Read stdin with optional timeout.
 * @param {number|null} timeout - Timeout in milliseconds. If null, wait indefinitely until EOF.
 * @returns {Promise<string>} - The stdin content
 */
function readStdinWithTimeout(timeout = null) {
  return new Promise((resolve) => {
    let data = '';
    let hasData = false;
    let timer = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
      }
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onEnd);
      process.stdin.removeListener('error', onError);
    };

    const onData = (chunk) => {
      hasData = true;
      if (timer) {
        clearTimeout(timer);
      }
      data += chunk;
    };

    const onEnd = () => {
      cleanup();
      resolve(data);
    };

    const onError = () => {
      cleanup();
      resolve('');
    };

    // Only set timeout if specified (not null)
    if (timeout !== null) {
      timer = setTimeout(() => {
        if (!hasData) {
          process.stdin.pause();
          cleanup();
          resolve('');
        }
      }, timeout);
    }

    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.on('error', onError);
  });
}

/**
 * Read system message from files if specified
 * @param {object} argv - Command line arguments
 * @returns {object} - { systemMessage, appendSystemMessage }
 */
async function readSystemMessages(argv) {
  let systemMessage = argv['system-message'];
  let appendSystemMessage = argv['append-system-message'];

  if (argv['system-message-file']) {
    const resolvedPath = require('path').resolve(
      process.cwd(),
      argv['system-message-file']
    );
    const file = Bun.file(resolvedPath);
    if (!(await file.exists())) {
      outputError({
        errorType: 'FileNotFound',
        message: `System message file not found: ${argv['system-message-file']}`,
      });
      process.exit(1);
    }
    systemMessage = await file.text();
  }

  if (argv['append-system-message-file']) {
    const resolvedPath = require('path').resolve(
      process.cwd(),
      argv['append-system-message-file']
    );
    const file = Bun.file(resolvedPath);
    if (!(await file.exists())) {
      outputError({
        errorType: 'FileNotFound',
        message: `Append system message file not found: ${argv['append-system-message-file']}`,
      });
      process.exit(1);
    }
    appendSystemMessage = await file.text();
  }

  return { systemMessage, appendSystemMessage };
}

async function runAgentMode(argv, request) {
  // Log version and command info in verbose mode using lazy logging
  Log.Default.info(() => ({
    message: 'Agent started',
    version: pkg.version,
    command: process.argv.join(' '),
    workingDirectory: process.cwd(),
    scriptPath: import.meta.path,
  }));
  if (Flag.OPENCODE_DRY_RUN) {
    Log.Default.info(() => ({
      message: 'Dry run mode enabled',
      mode: 'dry-run',
    }));
  }

  // Validate and get JSON standard
  const jsonStandard = argv['json-standard'];
  if (!isValidJsonStandard(jsonStandard)) {
    outputStatus({
      type: 'error',
      errorType: 'ValidationError',
      message: `Invalid JSON standard: ${jsonStandard}. Use "opencode" or "claude".`,
    });
    process.exit(1);
  }

  const { systemMessage, appendSystemMessage } = await readSystemMessages(argv);

  // Logging is already initialized in middleware, no need to call Log.init() again

  // Wrap in Instance.provide for OpenCode infrastructure
  // parseModelConfig must be called inside Instance.provide to access provider state
  await Instance.provide({
    directory: process.cwd(),
    fn: async () => {
      // Parse model config inside Instance.provide context
      // This allows parseModelWithResolution to access the provider state
      const { providerID, modelID } = await parseModelConfig(
        argv,
        outputError,
        outputStatus
      );

      if (argv.server) {
        // SERVER MODE: Start server and communicate via HTTP
        await runServerMode(
          argv,
          request,
          providerID,
          modelID,
          systemMessage,
          appendSystemMessage,
          jsonStandard
        );
      } else {
        // DIRECT MODE: Run everything in single process
        await runDirectMode(
          argv,
          request,
          providerID,
          modelID,
          systemMessage,
          appendSystemMessage,
          jsonStandard
        );
      }
    },
  });

  // Explicitly exit to ensure process terminates
  process.exit(hasError ? 1 : 0);
}

/**
 * Run agent in continuous stdin mode
 * Keeps accepting input until EOF or SIGINT
 * @param {object} argv - Command line arguments
 */
async function runContinuousAgentMode(argv) {
  const compactJson = argv['compact-json'] === true;
  // Log version and command info in verbose mode using lazy logging
  Log.Default.info(() => ({
    message: 'Agent started (continuous mode)',
    version: pkg.version,
    command: process.argv.join(' '),
    workingDirectory: process.cwd(),
    scriptPath: import.meta.path,
  }));
  if (Flag.OPENCODE_DRY_RUN) {
    Log.Default.info(() => ({
      message: 'Dry run mode enabled',
      mode: 'dry-run',
    }));
  }

  // Validate and get JSON standard
  const jsonStandard = argv['json-standard'];
  if (!isValidJsonStandard(jsonStandard)) {
    outputStatus(
      {
        type: 'error',
        message: `Invalid JSON standard: ${jsonStandard}. Use "opencode" or "claude".`,
      },
      compactJson
    );
    process.exit(1);
  }

  const { systemMessage, appendSystemMessage } = await readSystemMessages(argv);

  // Wrap in Instance.provide for OpenCode infrastructure
  // parseModelConfig must be called inside Instance.provide to access provider state
  await Instance.provide({
    directory: process.cwd(),
    fn: async () => {
      // Parse model config inside Instance.provide context
      // This allows parseModelWithResolution to access the provider state
      const { providerID, modelID } = await parseModelConfig(
        argv,
        outputError,
        outputStatus
      );

      if (argv.server) {
        // SERVER MODE: Start server and communicate via HTTP
        await runContinuousServerMode(
          argv,
          providerID,
          modelID,
          systemMessage,
          appendSystemMessage,
          jsonStandard
        );
      } else {
        // DIRECT MODE: Run everything in single process
        await runContinuousDirectMode(
          argv,
          providerID,
          modelID,
          systemMessage,
          appendSystemMessage,
          jsonStandard
        );
      }
    },
  });

  // Explicitly exit to ensure process terminates
  process.exit(hasError ? 1 : 0);
}

async function runServerMode(
  argv,
  request,
  providerID,
  modelID,
  systemMessage,
  appendSystemMessage,
  jsonStandard
) {
  const compactJson = argv['compact-json'] === true;

  // Start server like OpenCode does
  const server = Server.listen({ port: 0, hostname: '127.0.0.1' });
  let unsub = null;

  try {
    // Check if we should resume an existing session
    const resumeInfo = await resolveResumeSession(argv, compactJson);

    let sessionID;

    if (resumeInfo) {
      // Use the resumed/forked session
      sessionID = resumeInfo.sessionID;
    } else {
      // Create a new session
      const createRes = await fetch(
        `http://${server.hostname}:${server.port}/session`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );
      const session = await createRes.json();
      sessionID = session.id;

      if (!sessionID) {
        throw new Error('Failed to create session');
      }
    }

    // Create event handler for the selected JSON standard
    const eventHandler = createEventHandler(jsonStandard, sessionID);

    // Subscribe to all bus events and output in selected format
    const { unsub: eventUnsub, idlePromise: eventPromise } =
      createBusEventSubscription({
        sessionID,
        eventHandler,
        onError: () => {
          hasError = true;
        },
      });
    unsub = eventUnsub;

    // Send message to session with specified model (default: opencode/grok-code)
    const message = request.message || 'hi';
    const parts = [{ type: 'text', text: message }];

    // Start the prompt (don't wait for response, events come via Bus)
    fetch(
      `http://${server.hostname}:${server.port}/session/${sessionID}/message`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parts,
          model: {
            providerID,
            modelID,
          },
          system: systemMessage,
          appendSystem: appendSystemMessage,
        }),
      }
    ).catch((error) => {
      hasError = true;
      eventHandler.output({
        type: 'error',
        timestamp: Date.now(),
        sessionID,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    // Wait for session to become idle
    await eventPromise;
  } finally {
    // Always clean up resources
    if (unsub) {
      unsub();
    }
    server.stop();
    await Instance.dispose();
  }
}

async function runDirectMode(
  argv,
  request,
  providerID,
  modelID,
  systemMessage,
  appendSystemMessage,
  jsonStandard
) {
  const compactJson = argv['compact-json'] === true;

  // DIRECT MODE: Run in single process without server
  let unsub = null;

  try {
    // Check if we should resume an existing session
    const resumeInfo = await resolveResumeSession(argv, compactJson);

    let sessionID;

    if (resumeInfo) {
      // Use the resumed/forked session
      sessionID = resumeInfo.sessionID;
    } else {
      // Create a new session directly
      const session = await Session.createNext({
        directory: process.cwd(),
      });
      sessionID = session.id;
    }

    // Create event handler for the selected JSON standard
    const eventHandler = createEventHandler(jsonStandard, sessionID);

    // Subscribe to all bus events and output in selected format
    const { unsub: eventUnsub, idlePromise: eventPromise } =
      createBusEventSubscription({
        sessionID,
        eventHandler,
        onError: () => {
          hasError = true;
        },
      });
    unsub = eventUnsub;

    // Send message to session directly
    const message = request.message || 'hi';
    const parts = [{ type: 'text', text: message }];

    // Start the prompt directly without HTTP
    SessionPrompt.prompt({
      sessionID,
      parts,
      model: {
        providerID,
        modelID,
      },
      system: systemMessage,
      appendSystem: appendSystemMessage,
    }).catch((error) => {
      hasError = true;
      eventHandler.output({
        type: 'error',
        timestamp: Date.now(),
        sessionID,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    // Wait for session to become idle
    await eventPromise;
  } finally {
    // Always clean up resources
    if (unsub) {
      unsub();
    }
    await Instance.dispose();
  }
}

async function main() {
  try {
    // Parse command line arguments with subcommands
    const yargsInstance = yargs(hideBin(process.argv))
      .scriptName('agent')
      .usage('$0 [command] [options]')
      .version(pkg.version)
      // MCP subcommand
      .command(McpCommand)
      // Auth subcommand
      .command(AuthCommand)
      // Default command for agent mode (when no subcommand specified)
      .command({
        command: '$0',
        describe: 'Run agent in interactive or stdin mode (default)',
        builder: (yargs) =>
          yargs
            .option('model', {
              type: 'string',
              description: 'Model to use in format providerID/modelID',
              default: 'opencode/kimi-k2.5-free',
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
              description:
                'Prompt message to send directly (bypasses stdin reading)',
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
            })
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
            .option('output-response-model', {
              type: 'boolean',
              description: 'Include model info in step_finish output',
              default: true,
            })
            .option('summarize-session', {
              type: 'boolean',
              description: 'Generate AI session summaries',
              default: false,
            }),
        handler: async (argv) => {
          // Check both CLI flag and environment variable for compact JSON mode
          const compactJson =
            argv['compact-json'] === true || Flag.COMPACT_JSON();

          // Check if --prompt flag was provided
          if (argv.prompt) {
            // Direct prompt mode - bypass stdin entirely
            const request = { message: argv.prompt };
            await runAgentMode(argv, request);
            return;
          }

          // Check if --disable-stdin was set without --prompt
          if (argv['disable-stdin']) {
            // Output a helpful message suggesting to use --prompt
            outputError(
              {
                errorType: 'ValidationError',
                message:
                  'No prompt provided. Use -p/--prompt to specify a message, or remove --disable-stdin to read from stdin.',
                hint: 'Example: agent -p "Hello, how are you?"',
              },
              compactJson
            );
            process.exit(1);
          }

          // Check if stdin is a TTY (interactive terminal)
          if (process.stdin.isTTY) {
            // Enter interactive terminal mode with continuous listening
            const isInteractive = argv.interactive !== false;
            const autoMerge = argv['auto-merge-queued-messages'] !== false;
            const alwaysAcceptStdin = argv['always-accept-stdin'] !== false;

            // Exit if --no-always-accept-stdin is set (single message mode not supported in TTY)
            if (!alwaysAcceptStdin) {
              outputError(
                {
                  errorType: 'ValidationError',
                  message:
                    'Single message mode (--no-always-accept-stdin) is not supported in interactive terminal mode.',
                  hint: 'Use piped input or --prompt for single messages.',
                },
                compactJson
              );
              process.exit(1);
            }

            outputStatus(
              {
                type: 'status',
                mode: 'interactive-terminal',
                message:
                  'Agent CLI in interactive terminal mode. Type your message and press Enter.',
                hint: 'Press CTRL+C to exit. Use --help for options.',
                acceptedFormats: isInteractive
                  ? ['JSON object with "message" field', 'Plain text']
                  : ['JSON object with "message" field'],
                options: {
                  interactive: isInteractive,
                  autoMergeQueuedMessages: autoMerge,
                  alwaysAcceptStdin,
                  compactJson,
                },
              },
              compactJson
            );

            // Use continuous mode for interactive terminal
            await runContinuousAgentMode(argv);
            return;
          }

          // stdin is piped - enter stdin listening mode
          const isInteractive = argv.interactive !== false;
          const autoMerge = argv['auto-merge-queued-messages'] !== false;
          const alwaysAcceptStdin = argv['always-accept-stdin'] !== false;

          outputStatus(
            {
              type: 'status',
              mode: 'stdin-stream',
              message: alwaysAcceptStdin
                ? 'Agent CLI in continuous listening mode. Accepts JSON and plain text input.'
                : 'Agent CLI in single-message mode. Accepts JSON and plain text input.',
              hint: 'Press CTRL+C to exit. Use --help for options.',
              acceptedFormats: isInteractive
                ? ['JSON object with "message" field', 'Plain text']
                : ['JSON object with "message" field'],
              options: {
                interactive: isInteractive,
                autoMergeQueuedMessages: autoMerge,
                alwaysAcceptStdin,
                compactJson,
              },
            },
            compactJson
          );

          // Use continuous mode if --always-accept-stdin is enabled (default)
          if (alwaysAcceptStdin) {
            await runContinuousAgentMode(argv);
            return;
          }

          // Single-message mode (--no-always-accept-stdin)
          const timeout = argv['stdin-stream-timeout'] ?? null;
          const input = await readStdinWithTimeout(timeout);
          const trimmedInput = input.trim();

          if (trimmedInput === '') {
            outputStatus(
              {
                type: 'status',
                message: 'No input received. Exiting.',
              },
              compactJson
            );
            yargsInstance.showHelp();
            process.exit(0);
          }

          // Try to parse as JSON, if it fails treat it as plain text message
          let request;
          try {
            request = JSON.parse(trimmedInput);
          } catch (_e) {
            // Not JSON
            if (!isInteractive) {
              // In non-interactive mode, only accept JSON
              outputError(
                {
                  errorType: 'ValidationError',
                  message:
                    'Invalid JSON input. In non-interactive mode (--no-interactive), only JSON input is accepted.',
                  hint: 'Use --interactive to accept plain text, or provide valid JSON: {"message": "your text"}',
                },
                compactJson
              );
              process.exit(1);
            }
            // In interactive mode, treat as plain text message
            request = {
              message: trimmedInput,
            };
          }

          // Output input confirmation in JSON format
          outputInput(
            {
              raw: trimmedInput,
              parsed: request,
              format: isInteractive ? 'text' : 'json',
            },
            compactJson
          );

          // Run agent mode
          await runAgentMode(argv, request);
        },
      })
      // Initialize logging and flags early for all CLI commands
      .middleware(async (argv) => {
        const isCompact = argv['compact-json'] === true || Flag.COMPACT_JSON();
        if (isCompact) {
          setCompactJson(true);
        }
        if (argv.verbose) {
          Flag.setVerbose(true);
        }
        if (argv['dry-run']) {
          Flag.setDryRun(true);
        }
        if (argv['generate-title'] === true) {
          Flag.setGenerateTitle(true);
        }
        // output-response-model is enabled by default, only set if explicitly disabled
        if (argv['output-response-model'] === false) {
          Flag.setOutputResponseModel(false);
        }
        if (argv['summarize-session'] === true) {
          Flag.setSummarizeSession(true);
        }
        await Log.init({
          print: Flag.OPENCODE_VERBOSE,
          level: Flag.OPENCODE_VERBOSE ? 'DEBUG' : 'INFO',
          compactJson: isCompact,
        });
      })
      .fail((msg, err, yargs) => {
        // Handle errors from command handlers
        if (err) {
          // Check if it's a CancelledError (user pressed ESC)
          if (UI.CancelledError.isInstance(err)) {
            // Exit silently without showing error or help text
            process.exit(0);
          }

          // Format other errors using FormatError
          const formatted = FormatError(err);
          if (formatted) {
            outputError({
              errorType: err.name || 'Error',
              message: formatted,
            });
          } else {
            // Fallback to default error formatting
            outputError({
              errorType: err.name || 'Error',
              message: err.message || String(err),
            });
          }
          process.exit(1);
        }

        // Handle validation messages (msg without err) - informational, not an error
        // Display help text on stdout (industry standard: git, gh, npm all use stdout for help)
        if (msg) {
          outputHelp({
            message: msg,
            hint: stripAnsi(yargs.help()),
          });
          process.exit(0);
        }
      })
      .help();

    // Parse arguments (handlers will be called automatically)
    await yargsInstance.argv;
  } catch (error) {
    hasError = true;
    outputError({
      timestamp: Date.now(),
      errorType: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

main();
