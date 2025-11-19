import { test, assert } from 'test-anywhere'
// @ts-ignore
import { sh } from 'command-stream'
import { writeFileSync, readFileSync, unlinkSync } from 'fs'

test('Agent-cli edit tool produces OpenCode-compatible JSON output', async () => {
  const testFileName = `test-edit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.txt`

  // Create a test file in project root
  writeFileSync(testFileName, 'Hello World\n')

  try {
    // Test our agent-cli edit tool (compatible with OpenCode format)
    const projectRoot = process.cwd()
    const input = `{"message":"edit file","tools":[{"name":"edit","params":{"filePath":"${testFileName}","oldString":"Hello","newString":"Hi"}}]}`
    const agentResult = await sh(`echo '${input}' | bun run ${projectRoot}/src/index.js`)
    const agentLines = agentResult.stdout.trim().split('\n').filter(line => line.trim())
    const agentEvents = agentLines.map(line => JSON.parse(line))

    // Document expected OpenCode JSON structure for edit tool
    console.log('Expected OpenCode JSON event structure for edit tool:')
    console.log('{"type":"tool_use","timestamp":1234567890,"sessionID":"ses_xxx","part":{"tool":"edit","state":{"status":"completed","input":{"filePath":"...","oldString":"...","newString":"..."},"output":"success"}}}')

    // Find tool_use events
    const agentToolEvents = agentEvents.filter(e => e.type === 'tool_use' && e.part.tool === 'edit')

    // Should have tool_use events for edit
    assert.ok(agentToolEvents.length > 0, 'Agent should have edit tool_use events')

    // Check the structure matches OpenCode format
    const agentTool = agentToolEvents[0]

    // Validate top-level structure
    assert.equal(typeof agentTool.type, 'string', 'Event should have type field')
    assert.equal(agentTool.type, 'tool_use', 'Event type should be tool_use')
    assert.equal(typeof agentTool.timestamp, 'number', 'Event should have timestamp')
    assert.equal(typeof agentTool.sessionID, 'string', 'Event should have sessionID')

    // Validate part structure
    assert.ok(agentTool.part, 'Event should have part object')
    assert.equal(agentTool.part.tool, 'edit', 'Part tool should be edit')
    assert.equal(agentTool.part.type, 'tool', 'Part type should be tool')

    // Validate state structure
    assert.ok(agentTool.part.state, 'Part should have state object')
    assert.equal(agentTool.part.state.status, 'completed', 'Tool status should be completed')
    assert.equal(typeof agentTool.part.state.title, 'string', 'State should have title')
    assert.ok(agentTool.part.state.input, 'State should have input')
    assert.equal(typeof agentTool.part.state.input.filePath, 'string', 'Input should have filePath')
    assert.equal(typeof agentTool.part.state.input.oldString, 'string', 'Input should have oldString')
    assert.equal(typeof agentTool.part.state.input.newString, 'string', 'Input should have newString')
    assert.equal(typeof agentTool.part.state.output, 'string', 'State should have output')

    // Validate timing information
    assert.ok(agentTool.part.time, 'Part should have time object')
    assert.equal(typeof agentTool.part.time.start, 'number', 'Time should have start timestamp')
    assert.equal(typeof agentTool.part.time.end, 'number', 'Time should have end timestamp')

    // Verify the file was actually edited
    const finalContent = readFileSync(testFileName, 'utf-8')
    assert.ok(finalContent.includes('Hi World'), 'File should be edited')

    console.log('✅ Edit tool test passed - agent-cli produces OpenCode-compatible JSON format')
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