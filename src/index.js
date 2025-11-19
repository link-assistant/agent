#!/usr/bin/env node

import { Agent } from './session/agent.js'

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
    // Read JSON from stdin
    const input = await readStdin()
    const request = JSON.parse(input.trim())

    // Create agent and process request (events are emitted during processing)
    const agent = new Agent()
    await agent.process(request)

    // No final output since we stream events
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