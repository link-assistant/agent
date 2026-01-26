#!/usr/bin/env bun

import { Server } from './server/server.ts'
import { Instance } from './project/instance.ts'
import { Log } from './util/log.ts'
import { Bus } from './bus/index.ts'
import { Session } from './session/index.ts'
import { SessionPrompt } from './session/prompt.ts'
import { EOL } from 'os'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { createEventHandler, isValidJsonStandard } from './json-standard/index.ts'
import { McpCommand } from './cli/cmd/mcp.ts'
import { AuthCommand } from './cli/cmd/auth.ts'

// Track if any errors occurred during execution
let hasError = false

// Install global error handlers to ensure non-zero exit codes
process.on('uncaughtException', (error) => {
  hasError = true
  console.error(JSON.stringify({
    type: 'error',
    errorType: error.name || 'UncaughtException',
    message: error.message,
    stack: error.stack
  }, null, 2))
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  hasError = true
  console.error(JSON.stringify({
    type: 'error',
    errorType: 'UnhandledRejection',
    message: reason?.message || String(reason),
    stack: reason?.stack
  }, null, 2))
  process.exit(1)
})

async function readStdin() {
  return new Promise((resolve, reject) => {
    let data = ''
    const onData = chunk => {
      data += chunk
    }
    const onEnd = () => {
      cleanup()
      resolve(data)
    }
    const onError = err => {
      cleanup()
      reject(err)
    }
    const cleanup = () => {
      process.stdin.removeListener('data', onData)
      process.stdin.removeListener('end', onEnd)
      process.stdin.removeListener('error', onError)
    }
    process.stdin.on('data', onData)
    process.stdin.on('end', onEnd)
    process.stdin.on('error', onError)
  })
}

async function runAgentMode(argv) {
  // Parse model argument
  const modelParts = argv.model.split('/')
  const providerID = modelParts[0] || 'opencode'
  const modelID = modelParts[1] || 'grok-code'

  // Validate and get JSON standard
  const jsonStandard = argv['json-standard']
  if (!isValidJsonStandard(jsonStandard)) {
    console.error(`Invalid JSON standard: ${jsonStandard}. Use "opencode" or "claude".`)
    process.exit(1)
  }

  // Read system message files
  let systemMessage = argv['system-message']
  let appendSystemMessage = argv['append-system-message']

  if (argv['system-message-file']) {
    const resolvedPath = require('path').resolve(process.cwd(), argv['system-message-file'])
    const file = Bun.file(resolvedPath)
    if (!(await file.exists())) {
      console.error(`System message file not found: ${argv['system-message-file']}`)
      process.exit(1)
    }
    systemMessage = await file.text()
  }

  if (argv['append-system-message-file']) {
    const resolvedPath = require('path').resolve(process.cwd(), argv['append-system-message-file'])
    const file = Bun.file(resolvedPath)
    if (!(await file.exists())) {
      console.error(`Append system message file not found: ${argv['append-system-message-file']}`)
      process.exit(1)
    }
    appendSystemMessage = await file.text()
  }

  // Initialize logging to redirect to log file instead of stderr
  // This prevents log messages from mixing with JSON output
  await Log.init({
    print: false,  // Don't print to stderr
    level: 'INFO'
  })

  // Read input from stdin
  const input = await readStdin()
  const trimmedInput = input.trim()

  // Try to parse as JSON, if it fails treat it as plain text message
  let request
  try {
    request = JSON.parse(trimmedInput)
  } catch (e) {
    // Not JSON, treat as plain text message
    request = {
      message: trimmedInput
    }
  }

  // Wrap in Instance.provide for OpenCode infrastructure
  await Instance.provide({
    directory: process.cwd(),
    fn: async () => {
      if (argv.server) {
        // SERVER MODE: Start server and communicate via HTTP
        await runServerMode(request, providerID, modelID, systemMessage, appendSystemMessage, jsonStandard)
      } else {
        // DIRECT MODE: Run everything in single process
        await runDirectMode(request, providerID, modelID, systemMessage, appendSystemMessage, jsonStandard)
      }
    }
  })

  // Explicitly exit to ensure process terminates
  process.exit(hasError ? 1 : 0)
}

async function runServerMode(request, providerID, modelID, systemMessage, appendSystemMessage, jsonStandard) {
  // Start server like OpenCode does
  const server = Server.listen({ port: 0, hostname: "127.0.0.1" })
  let unsub = null

  try {
    // Create a session
    const createRes = await fetch(`http://${server.hostname}:${server.port}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })
    const session = await createRes.json()
    const sessionID = session.id

    if (!sessionID) {
      throw new Error("Failed to create session")
    }

    // Create event handler for the selected JSON standard
    const eventHandler = createEventHandler(jsonStandard, sessionID)

    // Subscribe to all bus events and output in selected format
    const eventPromise = new Promise((resolve) => {
      unsub = Bus.subscribeAll((event) => {
        // Output events in selected JSON format
        if (event.type === 'message.part.updated') {
          const part = event.properties.part
          if (part.sessionID !== sessionID) return

          // Output different event types
          if (part.type === 'step-start') {
            eventHandler.output({
              type: 'step_start',
              timestamp: Date.now(),
              sessionID,
              part
            })
          }

          if (part.type === 'step-finish') {
            eventHandler.output({
              type: 'step_finish',
              timestamp: Date.now(),
              sessionID,
              part
            })
          }

          if (part.type === 'text' && part.time?.end) {
            eventHandler.output({
              type: 'text',
              timestamp: Date.now(),
              sessionID,
              part
            })
          }

          if (part.type === 'tool' && part.state.status === 'completed') {
            eventHandler.output({
              type: 'tool_use',
              timestamp: Date.now(),
              sessionID,
              part
            })
          }
        }

        // Handle session idle to know when to stop
        if (event.type === 'session.idle' && event.properties.sessionID === sessionID) {
          resolve()
        }

        // Handle errors
        if (event.type === 'session.error') {
          const props = event.properties
          if (props.sessionID !== sessionID || !props.error) return
          hasError = true
          eventHandler.output({
            type: 'error',
            timestamp: Date.now(),
            sessionID,
            error: props.error
          })
        }
      })
    })

    // Send message to session with specified model (default: opencode/grok-code)
    const message = request.message || "hi"
    const parts = [{ type: "text", text: message }]

    // Start the prompt (don't wait for response, events come via Bus)
    fetch(`http://${server.hostname}:${server.port}/session/${sessionID}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parts,
        model: {
          providerID,
          modelID
        },
        system: systemMessage,
        appendSystem: appendSystemMessage
      })
    }).catch((error) => {
      hasError = true
      eventHandler.output({
        type: 'error',
        timestamp: Date.now(),
        sessionID,
        error: error instanceof Error ? error.message : String(error)
      })
    })

    // Wait for session to become idle
    await eventPromise
  } finally {
    // Always clean up resources
    if (unsub) unsub()
    server.stop()
    await Instance.dispose()
  }
}

async function runDirectMode(request, providerID, modelID, systemMessage, appendSystemMessage, jsonStandard) {
  // DIRECT MODE: Run in single process without server
  let unsub = null

  try {
    // Create a session directly
    const session = await Session.createNext({
      directory: process.cwd()
    })
    const sessionID = session.id

    // Create event handler for the selected JSON standard
    const eventHandler = createEventHandler(jsonStandard, sessionID)

    // Subscribe to all bus events and output in selected format
    const eventPromise = new Promise((resolve) => {
      unsub = Bus.subscribeAll((event) => {
        // Output events in selected JSON format
        if (event.type === 'message.part.updated') {
          const part = event.properties.part
          if (part.sessionID !== sessionID) return

          // Output different event types
          if (part.type === 'step-start') {
            eventHandler.output({
              type: 'step_start',
              timestamp: Date.now(),
              sessionID,
              part
            })
          }

          if (part.type === 'step-finish') {
            eventHandler.output({
              type: 'step_finish',
              timestamp: Date.now(),
              sessionID,
              part
            })
          }

          if (part.type === 'text' && part.time?.end) {
            eventHandler.output({
              type: 'text',
              timestamp: Date.now(),
              sessionID,
              part
            })
          }

          if (part.type === 'tool' && part.state.status === 'completed') {
            eventHandler.output({
              type: 'tool_use',
              timestamp: Date.now(),
              sessionID,
              part
            })
          }
        }

        // Handle session idle to know when to stop
        if (event.type === 'session.idle' && event.properties.sessionID === sessionID) {
          resolve()
        }

        // Handle errors
        if (event.type === 'session.error') {
          const props = event.properties
          if (props.sessionID !== sessionID || !props.error) return
          hasError = true
          eventHandler.output({
            type: 'error',
            timestamp: Date.now(),
            sessionID,
            error: props.error
          })
        }
      })
    })

    // Send message to session directly
    const message = request.message || "hi"
    const parts = [{ type: "text", text: message }]

    // Start the prompt directly without HTTP
    SessionPrompt.prompt({
      sessionID,
      parts,
      model: {
        providerID,
        modelID
      },
      system: systemMessage,
      appendSystem: appendSystemMessage
    }).catch((error) => {
      hasError = true
      eventHandler.output({
        type: 'error',
        timestamp: Date.now(),
        sessionID,
        error: error instanceof Error ? error.message : String(error)
      })
    })

    // Wait for session to become idle
    await eventPromise
  } finally {
    // Always clean up resources
    if (unsub) unsub()
    await Instance.dispose()
  }
}

async function main() {
  try {
    // Parse command line arguments with subcommands
    const argv = await yargs(hideBin(process.argv))
      .scriptName('agent')
      .usage('$0 [command] [options]')
      // MCP subcommand
      .command(McpCommand)
      // Auth subcommand
      .command(AuthCommand)
      // Default run mode (when piping stdin)
      .option('model', {
        type: 'string',
        description: 'Model to use in format providerID/modelID',
        default: 'opencode/grok-code'
      })
      .option('json-standard', {
        type: 'string',
        description: 'JSON output format standard: "opencode" (default) or "claude" (experimental)',
        default: 'opencode',
        choices: ['opencode', 'claude']
      })
      .option('system-message', {
        type: 'string',
        description: 'Full override of the system message'
      })
      .option('system-message-file', {
        type: 'string',
        description: 'Full override of the system message from file'
      })
      .option('append-system-message', {
        type: 'string',
        description: 'Append to the default system message'
      })
      .option('append-system-message-file', {
        type: 'string',
        description: 'Append to the default system message from file'
      })
      .option('server', {
        type: 'boolean',
        description: 'Run in server mode (default)',
        default: true
      })
      .help()
      .argv

    // If a command was executed (like mcp), yargs handles it
    // Otherwise, check if we should run in agent mode (stdin piped)
    const commandExecuted = argv._ && argv._.length > 0

    if (!commandExecuted) {
      // No command specified, run in default agent mode (stdin processing)
      await runAgentMode(argv)
    }
  } catch (error) {
    hasError = true
    console.error(JSON.stringify({
      type: 'error',
      timestamp: Date.now(),
      errorType: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    }, null, 2))
    process.exit(1)
  }
}

main()
