import { test, assert } from 'test-anywhere'
// @ts-ignore
import { sh } from 'command-stream'
import { writeFileSync, unlinkSync } from 'fs'

test('Agent-cli read tool produces OpenCode-compatible JSON output', async () => {
  const testFileName = `test-read-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.txt`

  // Create a test file in project root
  writeFileSync(testFileName, 'This is test content for reading\n')

  try {
    // Test our agent-cli read tool (compatible with OpenCode format)
    const projectRoot = process.cwd()
    const input = `{"message":"read file","tools":[{"name":"read","params":{"filePath":"${testFileName}"}}]}`
    const agentResult = await sh(`echo '${input}' | bun run ${projectRoot}/src/index.js`)
    const agentLines = agentResult.stdout.trim().split('\n').filter(line => line.trim())
    const agentEvents = agentLines.map(line => JSON.parse(line))

    // Document expected OpenCode JSON structure for read tool
    console.log('Expected OpenCode JSON event structure for read tool:')
    console.log('{"type":"tool_use","timestamp":1234567890,"sessionID":"ses_xxx","part":{"tool":"read","state":{"status":"completed","input":{"filePath":"..."},"output":"file content..."}}}')

    // Find tool_use events
    const agentToolEvents = agentEvents.filter(e => e.type === 'tool_use' && e.part.tool === 'read')

    // Should have tool_use events for read
    assert.ok(agentToolEvents.length > 0, 'Agent should have read tool_use events')

    // Check the structure matches OpenCode format
    const agentTool = agentToolEvents[0]

    // Validate top-level structure
    assert.equal(typeof agentTool.type, 'string', 'Event should have type field')
    assert.equal(agentTool.type, 'tool_use', 'Event type should be tool_use')
    assert.equal(typeof agentTool.timestamp, 'number', 'Event should have timestamp')
    assert.equal(typeof agentTool.sessionID, 'string', 'Event should have sessionID')

    // Validate part structure
    assert.ok(agentTool.part, 'Event should have part object')
    assert.equal(agentTool.part.tool, 'read', 'Part tool should be read')
    assert.equal(agentTool.part.type, 'tool', 'Part type should be tool')

    // Validate state structure
    assert.ok(agentTool.part.state, 'Part should have state object')
    assert.equal(agentTool.part.state.status, 'completed', 'Tool status should be completed')
    assert.equal(typeof agentTool.part.state.title, 'string', 'State should have title')
    assert.ok(agentTool.part.state.input, 'State should have input')
    assert.equal(typeof agentTool.part.state.input.filePath, 'string', 'Input should have filePath')
    assert.equal(typeof agentTool.part.state.output, 'string', 'State should have output')

    // Validate timing information
    assert.ok(agentTool.part.time, 'Part should have time object')
    assert.equal(typeof agentTool.part.time.start, 'number', 'Time should have start timestamp')
    assert.equal(typeof agentTool.part.time.end, 'number', 'Time should have end timestamp')

    // Check that output contains the file content
    assert.ok(agentTool.part.state.output.includes('This is test content'), 'Should have file content')

    console.log('✅ Read tool test passed - agent-cli produces OpenCode-compatible JSON format')
    console.log('Actual output structure validated against expected OpenCode format')
  } finally {
    // Clean up
    try {
      unlinkSync(testFileName)
    } catch (e) {
      // Ignore cleanup errors
    }
  }
})