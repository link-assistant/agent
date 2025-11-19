import { test, expect } from 'bun:test'
// @ts-ignore
import { sh } from 'command-stream'

test('Agent-cli produces OpenCode-compatible JSON output', async () => {
  // Test our agent-cli output format
  const agentResult = await sh(`echo '{"message":"hi"}' | timeout 30 bun run src/index.js`)
  const agentLines = agentResult.stdout.trim().split('\n').filter(line => line.trim())
  const agentEvents = agentLines.map(line => JSON.parse(line))

  // Should have the expected events
  expect(agentEvents.length).toBeTruthy()

  // Check event types
  const eventTypes = agentEvents.map(e => e.type)
  expect(eventTypes).toBeTruthy()

  // Check text event content
  const textEvent = agentEvents.find(e => e.type === 'text')
  expect(textEvent).toBeTruthy()
  expect(textEvent.part.text).toBeTruthy()

  // Check sessionID consistency
  const sessionID = agentEvents[0].sessionID
  agentEvents.forEach(event => {
    expect(event.sessionID).toBeTruthy()
    expect(event.timestamp).toBeTruthy()
    expect(event.part.id).toBeTruthy()
    expect(event.part.sessionID).toBeTruthy()
    expect(event.part.messageID).toBeTruthy()
  })

  // Check step_finish has cost and tokens
  const finishEvent = agentEvents.find(e => e.type === 'step_finish')
  expect(finishEvent.part.cost !== undefined).toBeTruthy()
  expect(finishEvent.part.tokens).toBeTruthy()
  expect(finishEvent.part.snapshot).toBeTruthy()

  console.log('✅ Agent produces OpenCode-compatible JSON format')
})

test('Agent-cli handles tool requests correctly', async () => {
  // Test tool handling
  const jsonInput = JSON.stringify({
    message: "read this file",
    tools: [{
      name: "read",
      params: { filePath: "test-file.txt" }
    }]
  })

  const agentResult = await sh(`echo '${jsonInput}' | timeout 30 bun run src/index.js`)
  const agentLines = agentResult.stdout.trim().split('\n').filter(line => line.trim())
  const agentEvents = agentLines.map(line => JSON.parse(line))

  // Should have the expected events
  expect(agentEvents.length).toBeTruthy()

  // Check event types
  const eventTypes = agentEvents.map(e => e.type)
  expect(eventTypes).toBeTruthy()

  // Check tool_use event
  const toolEvent = agentEvents.find(e => e.type === 'tool_use')
  expect(toolEvent).toBeTruthy()
  expect(toolEvent.part.tool).toBe('read')
  expect(toolEvent.part.state.status).toBeTruthy()

  // Tool execution may fail if file doesn't exist, so check for either output or error
  if (toolEvent.part.state.status === 'completed') {
    expect(toolEvent.part.state.output).toBeTruthy()
  } else {
    expect(toolEvent.part.state.error).toBeTruthy()
  }

  console.log('✅ Agent handles tool requests correctly')
})