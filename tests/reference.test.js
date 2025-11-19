import { test, assert } from 'test-anywhere'
// @ts-ignore
import { sh } from 'command-stream'

test('Agent-cli produces OpenCode-compatible JSON output', async () => {
  // Test our agent-cli output format
  const agentResult = await sh(`echo '{"message":"hi"}' | timeout 30 bun run src/index.js`)
  const agentLines = agentResult.stdout.trim().split('\n').filter(line => line.trim())
  const agentEvents = agentLines.map(line => JSON.parse(line))

  // Should have the expected events
  assert.equal(agentEvents.length, 3, 'Should have 3 events')

  // Check event types
  const eventTypes = agentEvents.map(e => e.type)
  assert.deepEqual(eventTypes, ['step_start', 'text', 'step_finish'], 'Should have correct event sequence')

  // Check text event content
  const textEvent = agentEvents.find(e => e.type === 'text')
  assert.ok(textEvent, 'Should have text event')
  assert.equal(textEvent.part.text, 'Hi!', 'Should have correct response text')

  // Check sessionID consistency
  const sessionID = agentEvents[0].sessionID
  agentEvents.forEach(event => {
    assert.equal(event.sessionID, sessionID, 'All events should have same sessionID')
    assert.ok(event.timestamp, 'Should have timestamp')
    assert.ok(event.part.id, 'Should have part ID')
    assert.ok(event.part.sessionID, 'Part should have sessionID')
    assert.ok(event.part.messageID, 'Part should have messageID')
  })

  // Check step_finish has cost and tokens
  const finishEvent = agentEvents.find(e => e.type === 'step_finish')
  assert.ok(finishEvent.part.cost !== undefined, 'Should have cost')
  assert.ok(finishEvent.part.tokens, 'Should have tokens')
  assert.ok(finishEvent.part.snapshot, 'Should have snapshot')

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
  assert.equal(agentEvents.length, 3, 'Should have 3 events for tool request')

  // Check event types
  const eventTypes = agentEvents.map(e => e.type)
  assert.deepEqual(eventTypes, ['step_start', 'tool_use', 'step_finish'], 'Should have step_start, tool_use, and step_finish')

  // Check tool_use event
  const toolEvent = agentEvents.find(e => e.type === 'tool_use')
  assert.ok(toolEvent, 'Should have tool_use event')
  assert.equal(toolEvent.part.tool, 'read', 'Should use read tool')
  assert.equal(toolEvent.part.state.status, 'completed', 'Tool should be completed')
  assert.ok(toolEvent.part.state.output, 'Should have tool output')

  console.log('✅ Agent handles tool requests correctly')
})