#!/usr/bin/env node

import { Server } from './server/server.ts'
import { Instance } from './project/instance.ts'
import { Log } from './util/log.ts'

async function readStdin() {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.on('data', chunk => {
      data += chunk
    })
    process.stdin.on('end', () => {
      resolve(data)
    })
    process.stdin.on('error', reject)
  })
}

async function main() {
  try {
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
        // Start server like OpenCode does
        const server = Server.listen({ port: 0, hostname: "127.0.0.1" })

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

          // Send message to session with Grok Code Fast 1 model (opencode/grok-code)
          const message = request.message || "hi"
          const parts = [{ type: "text", text: message }]

          const promptRes = await fetch(`http://${server.hostname}:${server.port}/session/${sessionID}/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              parts,
              model: {
                providerID: "opencode",
                modelID: "grok-code"
              }
            })
          })

          const promptData = await promptRes.text()

          // Output the result with pretty printing (unless AGENT_CLI_COMPACT=1)
          const compact = process.env.AGENT_CLI_COMPACT === '1'
          if (compact) {
            console.log(promptData)
          } else {
            const parsed = JSON.parse(promptData)
            console.log(JSON.stringify(parsed, null, 2))
          }

          // Stop server
          server.stop()
        } catch (error) {
          server.stop()
          throw error
        }
      }
    })

    // Explicitly exit to ensure process terminates
    process.exit(0)
  } catch (error) {
    console.error(JSON.stringify({
      type: 'error',
      timestamp: Date.now(),
      error: error instanceof Error ? error.message : String(error)
    }))
    process.exit(1)
  }
}

main()
