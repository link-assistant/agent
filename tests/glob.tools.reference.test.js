import { test, assert } from 'test-anywhere'
// @ts-ignore
import { sh } from 'command-stream'
import { writeFileSync, unlinkSync } from 'fs'

test('Agent-cli glob tool produces OpenCode-compatible JSON output', async () => {
  const timestamp = Date.now()
  const randomId = Math.random().toString(36).substr(2, 9)

  // Create test files with unique names
  const file1 = `test1-${timestamp}-${randomId}.txt`
  const file2 = `test2-${timestamp}-${randomId}.txt`
  const file3 = `other-${timestamp}-${randomId}.js`

  writeFileSync(file1, 'content1')
  writeFileSync(file2, 'content2')
  writeFileSync(file3, 'javascript')

  try {
    // Test our agent-cli glob tool (compatible with OpenCode format)
    const projectRoot = process.cwd()
    const input = `{"message":"find txt files","tools":[{"name":"glob","params":{"pattern":"test*-${timestamp}-${randomId}.txt"}}]}`
    const agentResult = await sh(`echo '${input}' | bun run ${projectRoot}/src/index.js`)
    const agentLines = agentResult.stdout.trim().split('\n').filter(line => line.trim())
    const agentEvents = agentLines.map(line => JSON.parse(line))

    // Document expected OpenCode JSON structure for glob tool
    console.log('Expected OpenCode JSON event structure for glob tool:')
    console.log('{"type":"tool_use","timestamp":1234567890,"sessionID":"ses_xxx","part":{"tool":"glob","state":{"status":"completed","input":{"pattern":"*.txt"},"output":{"matches":["file1.txt","file2.txt"]}}}}')

    // Find tool_use events
    const agentToolEvents = agentEvents.filter(e => e.type === 'tool_use' && e.part.tool === 'glob')

    // Should have tool_use events for glob
    assert.ok(agentToolEvents.length > 0, 'Agent should have glob tool_use events')

    // Check the structure matches OpenCode format
    const agentTool = agentToolEvents[0]

    // Validate top-level structure
    assert.equal(typeof agentTool.type, 'string', 'Event should have type field')
    assert.equal(agentTool.type, 'tool_use', 'Event type should be tool_use')
    assert.equal(typeof agentTool.timestamp, 'number', 'Event should have timestamp')
    assert.equal(typeof agentTool.sessionID, 'string', 'Event should have sessionID')

    // Validate part structure
    assert.ok(agentTool.part, 'Event should have part object')
    assert.equal(agentTool.part.tool, 'glob', 'Part tool should be glob')
    assert.equal(agentTool.part.type, 'tool', 'Part type should be tool')

    // Validate state structure
    assert.ok(agentTool.part.state, 'Part should have state object')
    assert.equal(agentTool.part.state.status, 'completed', 'Tool status should be completed')
    assert.equal(typeof agentTool.part.state.title, 'string', 'State should have title')
    assert.ok(agentTool.part.state.input, 'State should have input')
    assert.equal(typeof agentTool.part.state.input.pattern, 'string', 'Input should have pattern')
    assert.equal(typeof agentTool.part.state.output, 'string', 'State should have output')

    // Validate timing information
    assert.ok(agentTool.part.time, 'Part should have time object')
    assert.equal(typeof agentTool.part.time.start, 'number', 'Time should have start timestamp')
    assert.equal(typeof agentTool.part.time.end, 'number', 'Time should have end timestamp')

    // Check that output contains file matches
    const agentOutput = JSON.parse(agentTool.part.state.output)
    assert.ok(agentOutput.matches, 'Should have matches array')
    assert.ok(Array.isArray(agentOutput.matches), 'Matches should be an array')
    assert.ok(agentOutput.matches.length >= 2, 'Should find at least 2 txt files')

    // Validate that matches are strings (file paths)
    agentOutput.matches.forEach(match => {
      assert.equal(typeof match, 'string', 'Each match should be a string (file path)')
    })

    console.log('✅ Glob tool test passed - agent-cli produces OpenCode-compatible JSON format')
    console.log('Actual output structure validated against expected OpenCode format')
  } finally {
    // Clean up
    try {
      unlinkSync(file1)
      unlinkSync(file2)
      unlinkSync(file3)
    } catch (e) {
      // Ignore cleanup errors
    }
  }
})