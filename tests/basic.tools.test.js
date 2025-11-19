import { test, expect } from 'bun:test'
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
  expect(agentEvents.length > 0).toBeTruthy()

  // Check for step_start event
  const startEvents = agentEvents.filter(e => e.type === 'step_start')
  expect(startEvents.length > 0).toBeTruthy()

  // Check for step_finish event
  const finishEvents = agentEvents.filter(e => e.type === 'step_finish')
  expect(finishEvents.length > 0).toBeTruthy()

  // Check for text event (the AI response)
  const textEvents = agentEvents.filter(e => e.type === 'text')
  expect(textEvents.length > 0).toBeTruthy()
  expect(textEvents[0].part.text.length > 0).toBeTruthy()

  // Validate event structure
  for (const event of agentEvents) {
    expect(typeof event.type).toBeTruthy()
    expect(typeof event.timestamp).toBeTruthy()
    expect(typeof event.sessionID).toBeTruthy()
    expect(event.sessionID.startsWith('ses_')).toBeTruthy()
  }

  console.log('✅ Basic JSON processing test passed')
  console.log(`Produced ${agentEvents.length} events`)
})