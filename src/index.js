#!/usr/bin/env bun

import { Server } from './server/server.ts';
import { Instance } from './project/instance.ts';
import { Log } from './util/log.ts';
import { Bus } from './bus/index.ts';
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
import { Flag } from './flag/flag.ts';
import { FormatError } from './cli/error.ts';
import { UI } from './cli/ui.ts';
import {
  runContinuousServerMode,
  runContinuousDirectMode,
} from './cli/continuous-mode.js';
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
process.on('uncaughtException', (error) => {
  hasError = true;
  console.error(
    JSON.stringify(
      {
        type: 'error',
        errorType: error.name || 'UncaughtException',
        message: error.message,
        stack: error.stack,
      },
      null,
      2
    )
  );
  process.exit(1);
});

process.on('unhandledRejection', (reason, _promise) => {
  hasError = true;
  console.error(
    JSON.stringify(
      {
        type: 'error',
        errorType: 'UnhandledRejection',
        message: reason?.message || String(reason),
        stack: reason?.stack,
      },
      null,
      2
    )
  );
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
 * Output JSON status message to stderr
 * This prevents the status message from interfering with JSON output parsing
 * @param {object} status - Status object to output
 * @param {boolean} compact - If true, output compact JSON (single line)
 */
function outputStatus(status, compact = false) {
  const json = compact
    ? JSON.stringify(status)
    : JSON.stringify(status, null, 2);
  console.error(json);
}

/**
 * Parse model configuration from argv
 * @param {object} argv - Command line arguments
 * @returns {object} - { providerID, modelID }
 */
async function parseModelConfig(argv) {
  // Parse model argument (handle model IDs with slashes like groq/qwen/qwen3-32b)
  const modelParts = argv.model.split('/');
  let providerID = modelParts[0] || 'opencode';
  let modelID = modelParts.slice(1).join('/') || 'grok-code';

  // Handle --use-existing-claude-oauth option
  // This reads OAuth credentials from ~/.claude/.credentials.json (Claude Code CLI)
  // For new authentication, use: agent auth login (select Anthropic > Claude Pro/Max)
  if (argv['use-existing-claude-oauth']) {
    // Import ClaudeOAuth to check for credentials from Claude Code CLI
    const { ClaudeOAuth } = await import('./auth/claude-oauth.ts');
    const creds = await ClaudeOAuth.getCredentials();

    if (!creds?.accessToken) {
      const compactJson = argv['compact-json'] === true;
      outputStatus(
        {
          type: 'error',
          errorType: 'AuthenticationError',
          message:
            'No Claude OAuth credentials found in ~/.claude/.credentials.json. Either authenticate with Claude Code CLI first, or use: agent auth login (select Anthropic > Claude Pro/Max)',
        },
        compactJson
      );
      process.exit(1);
    }

    // Set environment variable for the provider to use
    process.env.CLAUDE_CODE_OAUTH_TOKEN = creds.accessToken;

    // If user specified a model, use it with claude-oauth provider
    // If not, use claude-oauth/claude-sonnet-4-5 as default
    if (providerID === 'opencode' && modelID === 'grok-code') {
      providerID = 'claude-oauth';
      modelID = 'claude-sonnet-4-5';
    } else if (!['claude-oauth', 'anthropic'].includes(providerID)) {
      // If user specified a different provider, warn them
      const compactJson = argv['compact-json'] === true;
      outputStatus(
        {
          type: 'warning',
          message: `--use-existing-claude-oauth is set but model uses provider "${providerID}". Using OAuth credentials anyway.`,
        },
        compactJson
      );
      providerID = 'claude-oauth';
    }
  }

  return { providerID, modelID };
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
      console.error(
        `System message file not found: ${argv['system-message-file']}`
      );
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
      console.error(
        `Append system message file not found: ${argv['append-system-message-file']}`
      );
      process.exit(1);
    }
    appendSystemMessage = await file.text();
  }

  return { systemMessage, appendSystemMessage };
}

async function runAgentMode(argv, request) {
  // Note: verbose flag and logging are now initialized in middleware
  // See main() function for the middleware that sets up Flag and Log.init()

  // Log version and command info in verbose mode
  if (Flag.OPENCODE_VERBOSE) {
    console.error(`Agent version: ${pkg.version}`);
    console.error(`Command: ${process.argv.join(' ')}`);
    console.error(`Working directory: ${process.cwd()}`);
    console.error(`Script path: ${import.meta.path}`);
  }

  // Log dry-run mode if enabled
  if (Flag.OPENCODE_DRY_RUN) {
    console.error(
      `[DRY RUN MODE] No actual API calls or package installations will be made`
    );
  }

  const { providerID, modelID } = await parseModelConfig(argv);

  // Validate and get JSON standard
  const jsonStandard = argv['json-standard'];
  if (!isValidJsonStandard(jsonStandard)) {
    console.error(
      `Invalid JSON standard: ${jsonStandard}. Use "opencode" or "claude".`
    );
    process.exit(1);
  }

  const { systemMessage, appendSystemMessage } = await readSystemMessages(argv);

  // Logging is already initialized in middleware, no need to call Log.init() again

  // Wrap in Instance.provide for OpenCode infrastructure
  await Instance.provide({
    directory: process.cwd(),
    fn: async () => {
      if (argv.server) {
        // SERVER MODE: Start server and communicate via HTTP
        await runServerMode(
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
  // Note: verbose flag and logging are now initialized in middleware
  // See main() function for the middleware that sets up Flag and Log.init()

  const compactJson = argv['compact-json'] === true;

  // Log version and command info in verbose mode
  if (Flag.OPENCODE_VERBOSE) {
    console.error(`Agent version: ${pkg.version}`);
    console.error(`Command: ${process.argv.join(' ')}`);
    console.error(`Working directory: ${process.cwd()}`);
    console.error(`Script path: ${import.meta.path}`);
  }

  // Log dry-run mode if enabled
  if (Flag.OPENCODE_DRY_RUN) {
    console.error(
      `[DRY RUN MODE] No actual API calls or package installations will be made`
    );
  }

  const { providerID, modelID } = await parseModelConfig(argv);

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
  await Instance.provide({
    directory: process.cwd(),
    fn: async () => {
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
  request,
  providerID,
  modelID,
  systemMessage,
  appendSystemMessage,
  jsonStandard
) {
  // Start server like OpenCode does
  const server = Server.listen({ port: 0, hostname: '127.0.0.1' });
  let unsub = null;

  try {
    // Create a session
    const createRes = await fetch(
      `http://${server.hostname}:${server.port}/session`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }
    );
    const session = await createRes.json();
    const sessionID = session.id;

    if (!sessionID) {
      throw new Error('Failed to create session');
    }

    // Create event handler for the selected JSON standard
    const eventHandler = createEventHandler(jsonStandard, sessionID);

    // Subscribe to all bus events and output in selected format
    const eventPromise = new Promise((resolve) => {
      unsub = Bus.subscribeAll((event) => {
        // Output events in selected JSON format
        if (event.type === 'message.part.updated') {
          const part = event.properties.part;
          if (part.sessionID !== sessionID) {
            return;
          }

          // Output different event types
          if (part.type === 'step-start') {
            eventHandler.output({
              type: 'step_start',
              timestamp: Date.now(),
              sessionID,
              part,
            });
          }

          if (part.type === 'step-finish') {
            eventHandler.output({
              type: 'step_finish',
              timestamp: Date.now(),
              sessionID,
              part,
            });
          }

          if (part.type === 'text' && part.time?.end) {
            eventHandler.output({
              type: 'text',
              timestamp: Date.now(),
              sessionID,
              part,
            });
          }

          if (part.type === 'tool' && part.state.status === 'completed') {
            eventHandler.output({
              type: 'tool_use',
              timestamp: Date.now(),
              sessionID,
              part,
            });
          }
        }

        // Handle session idle to know when to stop
        if (
          event.type === 'session.idle' &&
          event.properties.sessionID === sessionID
        ) {
          resolve();
        }

        // Handle errors
        if (event.type === 'session.error') {
          const props = event.properties;
          if (props.sessionID !== sessionID || !props.error) {
            return;
          }
          hasError = true;
          eventHandler.output({
            type: 'error',
            timestamp: Date.now(),
            sessionID,
            error: props.error,
          });
        }
      });
    });

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
  request,
  providerID,
  modelID,
  systemMessage,
  appendSystemMessage,
  jsonStandard
) {
  // DIRECT MODE: Run in single process without server
  let unsub = null;

  try {
    // Create a session directly
    const session = await Session.createNext({
      directory: process.cwd(),
    });
    const sessionID = session.id;

    // Create event handler for the selected JSON standard
    const eventHandler = createEventHandler(jsonStandard, sessionID);

    // Subscribe to all bus events and output in selected format
    const eventPromise = new Promise((resolve) => {
      unsub = Bus.subscribeAll((event) => {
        // Output events in selected JSON format
        if (event.type === 'message.part.updated') {
          const part = event.properties.part;
          if (part.sessionID !== sessionID) {
            return;
          }

          // Output different event types
          if (part.type === 'step-start') {
            eventHandler.output({
              type: 'step_start',
              timestamp: Date.now(),
              sessionID,
              part,
            });
          }

          if (part.type === 'step-finish') {
            eventHandler.output({
              type: 'step_finish',
              timestamp: Date.now(),
              sessionID,
              part,
            });
          }

          if (part.type === 'text' && part.time?.end) {
            eventHandler.output({
              type: 'text',
              timestamp: Date.now(),
              sessionID,
              part,
            });
          }

          if (part.type === 'tool' && part.state.status === 'completed') {
            eventHandler.output({
              type: 'tool_use',
              timestamp: Date.now(),
              sessionID,
              part,
            });
          }
        }

        // Handle session idle to know when to stop
        if (
          event.type === 'session.idle' &&
          event.properties.sessionID === sessionID
        ) {
          resolve();
        }

        // Handle errors
        if (event.type === 'session.error') {
          const props = event.properties;
          if (props.sessionID !== sessionID || !props.error) {
            return;
          }
          hasError = true;
          eventHandler.output({
            type: 'error',
            timestamp: Date.now(),
            sessionID,
            error: props.error,
          });
        }
      });
    });

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
              default: 'opencode/grok-code',
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
            }),
        handler: async (argv) => {
          const compactJson = argv['compact-json'] === true;

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
            outputStatus(
              {
                type: 'error',
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
              outputStatus(
                {
                  type: 'error',
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
              outputStatus(
                {
                  type: 'error',
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

          // Run agent mode
          await runAgentMode(argv, request);
        },
      })
      // Initialize logging early for all CLI commands
      // This prevents debug output from appearing in CLI unless --verbose is used
      .middleware(async (argv) => {
        // Set verbose flag if requested
        if (argv.verbose) {
          Flag.setVerbose(true);
        }

        // Set dry-run flag if requested
        if (argv['dry-run']) {
          Flag.setDryRun(true);
        }

        // Initialize logging system
        // - If verbose: print logs to stderr for debugging
        // - Otherwise: write logs to file to keep CLI output clean
        await Log.init({
          print: Flag.OPENCODE_VERBOSE,
          level: Flag.OPENCODE_VERBOSE ? 'DEBUG' : 'INFO',
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
            console.error(formatted);
          } else {
            // Fallback to default error formatting
            console.error(err.message || err);
          }
          process.exit(1);
        }

        // Handle validation errors (msg without err)
        if (msg) {
          console.error(msg);
          console.error(`\n${yargs.help()}`);
          process.exit(1);
        }
      })
      .help();

    // Parse arguments (handlers will be called automatically)
    await yargsInstance.argv;
  } catch (error) {
    hasError = true;
    console.error(
      JSON.stringify(
        {
          type: 'error',
          timestamp: Date.now(),
          errorType: error instanceof Error ? error.name : 'Error',
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        null,
        2
      )
    );
    process.exit(1);
  }
}

main();
