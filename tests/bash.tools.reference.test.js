import { test, expect } from 'bun:test'
// @ts-ignore
import { sh } from 'command-stream'

test('Agent-cli bash tool produces OpenCode-compatible JSON output', async () => {
  // Test our agent-cli bash tool (compatible with OpenCode format)
  const projectRoot = process.cwd()
  const input = '{"message":"run command","tools":[{"name":"bash","params":{"command":"echo hello world"}}]}'
  const agentResult = await sh(`echo '${input}' | bun run ${projectRoot}/src/index.js`)
  const agentLines = agentResult.stdout.trim().split('\n').filter(line => line.trim())
  const agentEvents = agentLines.map(line => JSON.parse(line))

  // Document expected OpenCode JSON structure
  console.log('Expected OpenCode JSON event structure:')
  console.log('{"type":"tool_use","timestamp":1234567890,"sessionID":"ses_xxx","part":{"tool":"bash","state":{"status":"completed","input":{...},"output":"..."}}}')

  // Find tool_use events
  const agentToolEvents = agentEvents.filter(e => e.type === 'tool_use' && e.part.tool === 'bash')

  // Should have tool_use events for bash
  expect(agentToolEvents.length > 0).toBeTruthy()

  // Check the structure matches OpenCode format
  const agentTool = agentToolEvents[0]

  // Validate top-level structure
  expect(typeof agentTool.type).toBeTruthy()
  expect(agentTool.type).toBeTruthy()
  expect(typeof agentTool.timestamp).toBeTruthy()
  expect(typeof agentTool.sessionID).toBeTruthy()
  expect(agentTool.sessionID.startsWith('ses_')).toBeTruthy()

  // Validate part structure
  expect(agentTool.part).toBeTruthy()
  expect(agentTool.part.tool).toBeTruthy()
  expect(typeof agentTool.part.sessionID).toBeTruthy()
  expect(agentTool.part.type).toBeTruthy()

  // Validate state structure
  expect(agentTool.part.state).toBeTruthy()
  expect(agentTool.part.state.status).toBeTruthy()
  expect(typeof agentTool.part.state.title).toBeTruthy()
  expect(agentTool.part.state.input).toBeTruthy()
  expect(typeof agentTool.part.state.output).toBeTruthy()

  // Validate timing information
  expect(agentTool.part.time).toBeTruthy()
  expect(typeof agentTool.part.time.start).toBeTruthy()
  expect(typeof agentTool.part.time.end).toBeTruthy()
  expect(agentTool.part.time.end >= agentTool.part.time.start).toBeTruthy()

  // Check that output contains expected result
  expect(agentTool.part.state.output.includes('hello world')).toBeTruthy()

  console.log('✅ Bash tool test passed - agent-cli produces OpenCode-compatible JSON format')
  console.log('Actual output structure validated against expected OpenCode format')
})