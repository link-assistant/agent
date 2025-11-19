import { test, assert } from 'test-anywhere'
// @ts-ignore
import { sh } from 'command-stream'

test('Agent-cli processes JSON input "hi" and produces JSON output', async () => {
  // Test our agent-cli with simple JSON input
  const projectRoot = process.cwd()
  const input = '{"message":"hi"}'
  const agentResult = await sh(`echo '${input}' | bun run ${projectRoot}/src/index.js`)
  const agentLines = agentResult.stdout.trim().split('\n').filter(line => line.trim())
  const agentEvents = agentLines.map(line => JSON.parse(line))

  // Should have events
  assert.ok(agentEvents.length > 0, 'Agent should produce JSON events')

  // Check for step_start event
  const startEvents = agentEvents.filter(e => e.type === 'step_start')
  assert.ok(startEvents.length > 0, 'Should have step_start events')

  // Check for step_finish event
  const finishEvents = agentEvents.filter(e => e.type === 'step_finish')
  assert.ok(finishEvents.length > 0, 'Should have step_finish events')

  // Check for text event (the AI response)
  const textEvents = agentEvents.filter(e => e.type === 'text')
  assert.ok(textEvents.length > 0, 'Should have text events')
  assert.ok(textEvents[0].part.text.length > 0, 'Should have non-empty response text')

  // Validate event structure
  for (const event of agentEvents) {
    assert.equal(typeof event.type, 'string', 'Event should have type field')
    assert.equal(typeof event.timestamp, 'number', 'Event should have timestamp')
    assert.equal(typeof event.sessionID, 'string', 'Event should have sessionID')
    assert.ok(event.sessionID.startsWith('session-'), 'SessionID should start with session-')
  }

  console.log('✅ Basic JSON processing test passed')
  console.log(`Produced ${agentEvents.length} events`)
})