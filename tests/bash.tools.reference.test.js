import { test, assert } from 'test-anywhere'
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
  assert.ok(agentToolEvents.length > 0, 'Agent should have bash tool_use events')

  // Check the structure matches OpenCode format
  const agentTool = agentToolEvents[0]

  // Validate top-level structure
  assert.equal(typeof agentTool.type, 'string', 'Event should have type field')
  assert.equal(agentTool.type, 'tool_use', 'Event type should be tool_use')
  assert.equal(typeof agentTool.timestamp, 'number', 'Event should have timestamp')
  assert.equal(typeof agentTool.sessionID, 'string', 'Event should have sessionID')
  assert.ok(agentTool.sessionID.startsWith('ses_'), 'SessionID should start with ses_')

  // Validate part structure
  assert.ok(agentTool.part, 'Event should have part object')
  assert.equal(agentTool.part.tool, 'bash', 'Part tool should be bash')
  assert.equal(typeof agentTool.part.sessionID, 'string', 'Part should have sessionID')
  assert.equal(agentTool.part.type, 'tool', 'Part type should be tool')

  // Validate state structure
  assert.ok(agentTool.part.state, 'Part should have state object')
  assert.equal(agentTool.part.state.status, 'completed', 'Tool status should be completed')
  assert.equal(typeof agentTool.part.state.title, 'string', 'State should have title')
  assert.ok(agentTool.part.state.input, 'State should have input')
  assert.equal(typeof agentTool.part.state.output, 'string', 'State should have output')

  // Validate timing information
  assert.ok(agentTool.part.time, 'Part should have time object')
  assert.equal(typeof agentTool.part.time.start, 'number', 'Time should have start timestamp')
  assert.equal(typeof agentTool.part.time.end, 'number', 'Time should have end timestamp')
  assert.ok(agentTool.part.time.end >= agentTool.part.time.start, 'End time should be >= start time')

  // Check that output contains expected result
  assert.ok(agentTool.part.state.output.includes('hello world'), 'Should have command output')

  console.log('✅ Bash tool test passed - agent-cli produces OpenCode-compatible JSON format')
  console.log('Actual output structure validated against expected OpenCode format')
})