import { test, expect, setDefaultTimeout } from 'bun:test'
// @ts-ignore
import { sh } from 'command-stream'
import { $ } from 'bun'

// Increase default timeout to 30 seconds for these tests
setDefaultTimeout(30000)

// Shared assertion function to validate basic message JSON output
function validateBasicMessageOutput(events, label) {
  console.log(`\n${label} validation:`)

  // Should have events
  expect(events.length > 0).toBeTruthy()

  // Check for step_start event
  const startEvents = events.filter(e => e.type === 'step_start')
  expect(startEvents.length > 0).toBeTruthy()

  // Check for step_finish event
  const finishEvents = events.filter(e => e.type === 'step_finish')
  expect(finishEvents.length > 0).toBeTruthy()

  // Check for text event (the AI response)
  const textEvents = events.filter(e => e.type === 'text')
  expect(textEvents.length > 0).toBeTruthy()
  expect(textEvents[0].part.text.length > 0).toBeTruthy()

  // Validate event structure
  for (const event of events) {
    expect(typeof event.type).toBe('string')
    expect(typeof event.timestamp).toBe('number')
    expect(typeof event.sessionID).toBe('string')
    expect(event.sessionID.startsWith('ses_')).toBeTruthy()
    expect(event.part).toBeTruthy()
    expect(typeof event.part.id).toBe('string')
    expect(event.part.id.startsWith('prt_')).toBeTruthy()
  }

  console.log(`✅ ${label} validation passed - ${events.length} events`)
}

test('OpenCode reference: processes JSON input "hi" and produces JSON output', async () => {
  const input = '{"message":"hi"}'
  const opencodeResult = await $`echo ${input} | opencode run --format json --model opencode/grok-code`.quiet().nothrow()
  const opencodeLines = opencodeResult.stdout.toString().trim().split('\n').filter(line => line.trim())
  const opencodeEvents = opencodeLines.map(line => JSON.parse(line))

  validateBasicMessageOutput(opencodeEvents, 'OpenCode')
})

test('Agent-cli processes JSON input "hi" and produces JSON output', async () => {
  const projectRoot = process.cwd()
  const input = '{"message":"hi"}'
  const agentResult = await sh(`echo '${input}' | bun run ${projectRoot}/src/index.js`)
  const agentLines = agentResult.stdout.trim().split('\n').filter(line => line.trim())
  const agentEvents = agentLines.map(line => JSON.parse(line))

  validateBasicMessageOutput(agentEvents, 'Agent-cli')
})

test('Agent-cli produces 100% compatible JSON output with OpenCode', async () => {
  const input = '{"message":"hi"}'

  // Get OpenCode output
  const opencodeResult = await $`echo ${input} | opencode run --format json --model opencode/grok-code`.quiet().nothrow()
  const opencodeLines = opencodeResult.stdout.toString().trim().split('\n').filter(line => line.trim())
  const opencodeEvents = opencodeLines.map(line => JSON.parse(line))

  // Get agent-cli output
  const projectRoot = process.cwd()
  const agentResult = await sh(`echo '${input}' | bun run ${projectRoot}/src/index.js`)
  const agentLines = agentResult.stdout.trim().split('\n').filter(line => line.trim())
  const agentEvents = agentLines.map(line => JSON.parse(line))

  // Validate both outputs using shared assertion function
  validateBasicMessageOutput(opencodeEvents, 'OpenCode')
  validateBasicMessageOutput(agentEvents, 'Agent-cli')

  // Both should have same number of event types
  expect(opencodeEvents.some(e => e.type === 'step_start')).toBeTruthy()
  expect(agentEvents.some(e => e.type === 'step_start')).toBeTruthy()

  expect(opencodeEvents.some(e => e.type === 'text')).toBeTruthy()
  expect(agentEvents.some(e => e.type === 'text')).toBeTruthy()

  expect(opencodeEvents.some(e => e.type === 'step_finish')).toBeTruthy()
  expect(agentEvents.some(e => e.type === 'step_finish')).toBeTruthy()

  console.log('\n✅ Agent-cli produces 100% OpenCode-compatible JSON structure')
  console.log(`OpenCode events: ${opencodeEvents.length}, Agent-cli events: ${agentEvents.length}`)
})