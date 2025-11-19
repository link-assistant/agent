import { test, assert } from 'test-anywhere'
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
  assert.ok(events.length > 0, 'Should have events')

  // Check for text event
  const textEvents = events.filter(e => e.type === 'text')
  assert.equal(textEvents.length, 1, 'Should have one text event')
  assert.equal(textEvents[0].part.text, 'Hi!', 'Should have correct response text')
  assert.equal(textEvents[0].sessionID, events[0].sessionID, 'Should have consistent sessionID')
  assert.ok(textEvents[0].timestamp, 'Should have timestamp')
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
    assert.ok(events.length > 0, 'Should have events')

    // Check for step_start events
    const stepStartEvents = events.filter(e => e.type === 'step_start')
    assert.equal(stepStartEvents.length, 1, 'Should have one step_start event')

    // Check for tool_use event
    const toolEvents = events.filter(e => e.type === 'tool_use')
    assert.equal(toolEvents.length, 1, 'Should have one tool_use event')
    assert.equal(toolEvents[0].part.tool, 'read', 'Should be read tool')
    assert.ok(toolEvents[0].part.state.output.includes('Hello World'), 'Should contain file content')

    // Check for step_finish events
    const stepFinishEvents = events.filter(e => e.type === 'step_finish')
    assert.equal(stepFinishEvents.length, 1, 'Should have one step_finish event')

    // All events should have the same sessionID
    const sessionID = events[0].sessionID
    events.forEach(event => {
      assert.equal(event.sessionID, sessionID, 'All events should have same sessionID')
      assert.ok(event.timestamp, 'Should have timestamp')
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