import { test, expect } from 'bun:test'
import { $ } from 'bun'
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

// Ensure tmp directory exists
const tmpDir = join(process.cwd(), 'tmp')
if (!existsSync(tmpDir)) {
  mkdirSync(tmpDir, { recursive: true })
}

test('MVP agent responds to JSON input with streaming events', async () => {
  // Pipe JSON input to the agent CLI
  const result = await $`echo '{"message":"hi"}' | bun run src/index.js`.quiet()

  // Parse all JSON lines from stdout
  const lines = result.stdout.toString().trim().split('\n').filter(line => line.trim())
  const events = lines.map(line => JSON.parse(line))

  // Verify we got events
  expect(events.length).toBeGreaterThan(0)

  // Check for text event
  const textEvents = events.filter(e => e.type === 'text')
  expect(textEvents.length).toBe(1)
  expect(textEvents[0].part.text).toBe('Hi!')
  expect(textEvents[0].sessionID).toBe(events[0].sessionID)
  expect(textEvents[0].timestamp).toBeTruthy()
})

test('MVP agent executes tools with streaming events', async () => {
  // Create a test file in tmp directory
  const testFile = join(tmpDir, 'test-file.txt')
  writeFileSync(testFile, 'Hello World\n')

  try {
    // Pipe JSON input with tools to the agent CLI
    const jsonInput = JSON.stringify({
      message: "read the test file",
      tools: [{
        name: "read",
        params: { filePath: testFile }
      }]
    })

    const result = await $`echo ${jsonInput} | bun run src/index.js`.quiet()

    // Parse all JSON lines from stdout
    const lines = result.stdout.toString().trim().split('\n').filter(line => line.trim())
    const events = lines.map(line => JSON.parse(line))

    // Verify we got events
    expect(events.length).toBeGreaterThan(0)

    // Check for step_start events
    const stepStartEvents = events.filter(e => e.type === 'step_start')
    expect(stepStartEvents.length).toBe(1)

    // Check for tool_use event
    const toolEvents = events.filter(e => e.type === 'tool_use')
    expect(toolEvents.length).toBe(1)
    expect(toolEvents[0].part.tool).toBe('read')
    expect(toolEvents[0].part.state.output).toContain('Hello World')

    // Check for step_finish events
    const stepFinishEvents = events.filter(e => e.type === 'step_finish')
    expect(stepFinishEvents.length).toBe(1)

    // All events should have the same sessionID
    const sessionID = events[0].sessionID
    events.forEach(event => {
      expect(event.sessionID).toBe(sessionID)
      expect(event.timestamp).toBeTruthy()
    })

  } finally {
    // Clean up
    try {
      unlinkSync(testFile)
    } catch (e) {
      // Ignore cleanup errors
    }
  }
})