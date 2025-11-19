import { test, expect } from 'bun:test'
// @ts-ignore
import { sh } from 'command-stream'
import { writeFileSync, unlinkSync } from 'fs'

test('MVP agent responds to JSON input with streaming events', async () => {
  // Pipe JSON input to the agent CLI using command-stream
  const result = await sh(`echo '{"message":"hi"}' | bun run src/index.js`)

  // Parse all JSON lines from stdout
  const lines = result.stdout.trim().split('\n').filter(line => line.trim())
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
  // Create a test file
  writeFileSync('test-file.txt', 'Hello World\n')

  try {
    // Pipe JSON input with tools to the agent CLI using command-stream
    const jsonInput = JSON.stringify({
      message: "read the test file",
      tools: [{
        name: "read",
        params: { filePath: "test-file.txt" }
      }]
    })

    const result = await sh(`echo '${jsonInput}' | bun run src/index.js`)

    // Parse all JSON lines from stdout
    const lines = result.stdout.trim().split('\n').filter(line => line.trim())
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
      unlinkSync('test-file.txt')
    } catch (e) {
      // Ignore cleanup errors
    }
  }
})