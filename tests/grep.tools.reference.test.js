import { test, assert } from 'test-anywhere'
// @ts-ignore
import { sh } from 'command-stream'
import { writeFileSync, unlinkSync } from 'fs'

test('Agent-cli grep tool produces OpenCode-compatible JSON output', async () => {
  const timestamp = Date.now()
  const randomId = Math.random().toString(36).substr(2, 9)

  // Create test files with unique names
  const file1 = `grep1-${timestamp}-${randomId}.txt`
  const file2 = `grep2-${timestamp}-${randomId}.txt`

  writeFileSync(file1, 'This is line 1\nThis contains search text\nThis is line 3\n')
  writeFileSync(file2, 'Another file\nMore search text here\nEnd of file\n')

  try {
    // Test our agent-cli grep tool (compatible with OpenCode format)
    const projectRoot = process.cwd()
    const input = `{"message":"search for text","tools":[{"name":"grep","params":{"pattern":"search","include":"grep*-${timestamp}-${randomId}.txt"}}]}`
    const agentResult = await sh(`echo '${input}' | bun run ${projectRoot}/src/index.js`)
    const agentLines = agentResult.stdout.trim().split('\n').filter(line => line.trim())
    const agentEvents = agentLines.map(line => JSON.parse(line))

    // Document expected OpenCode JSON structure for grep tool
    console.log('Expected OpenCode JSON event structure for grep tool:')
    console.log('{"type":"tool_use","timestamp":1234567890,"sessionID":"ses_xxx","part":{"tool":"grep","state":{"status":"completed","input":{"pattern":"search","include":"*.txt"},"output":{"matches":[{"file":"file.txt","line":2,"content":"..."}]}}}}')

    // Find tool_use events
    const agentToolEvents = agentEvents.filter(e => e.type === 'tool_use' && e.part.tool === 'grep')

    // Should have tool_use events for grep
    assert.ok(agentToolEvents.length > 0, 'Agent should have grep tool_use events')

    // Check the structure matches OpenCode format
    const agentTool = agentToolEvents[0]

    // Validate top-level structure
    assert.equal(typeof agentTool.type, 'string', 'Event should have type field')
    assert.equal(agentTool.type, 'tool_use', 'Event type should be tool_use')
    assert.equal(typeof agentTool.timestamp, 'number', 'Event should have timestamp')
    assert.equal(typeof agentTool.sessionID, 'string', 'Event should have sessionID')

    // Validate part structure
    assert.ok(agentTool.part, 'Event should have part object')
    assert.equal(agentTool.part.tool, 'grep', 'Part tool should be grep')
    assert.equal(agentTool.part.type, 'tool', 'Part type should be tool')

    // Validate state structure
    assert.ok(agentTool.part.state, 'Part should have state object')
    assert.equal(agentTool.part.state.status, 'completed', 'Tool status should be completed')
    assert.equal(typeof agentTool.part.state.title, 'string', 'State should have title')
    assert.ok(agentTool.part.state.input, 'State should have input')
    assert.equal(typeof agentTool.part.state.input.pattern, 'string', 'Input should have pattern')
    assert.equal(typeof agentTool.part.state.input.include, 'string', 'Input should have include')
    assert.equal(typeof agentTool.part.state.output, 'string', 'State should have output')

    // Validate timing information
    assert.ok(agentTool.part.time, 'Part should have time object')
    assert.equal(typeof agentTool.part.time.start, 'number', 'Time should have start timestamp')
    assert.equal(typeof agentTool.part.time.end, 'number', 'Time should have end timestamp')

    // Check that output contains matches
    const agentOutput = JSON.parse(agentTool.part.state.output)
    assert.ok(agentOutput.matches, 'Should have matches array')
    assert.ok(Array.isArray(agentOutput.matches), 'Matches should be an array')
    assert.ok(agentOutput.matches.length >= 2, 'Should find at least 2 matches')

    // Validate match structure
    agentOutput.matches.forEach(match => {
      assert.equal(typeof match.file, 'string', 'Match should have file path')
      assert.equal(typeof match.line, 'number', 'Match should have line number')
      assert.equal(typeof match.content, 'string', 'Match should have content')
      assert.ok(match.content.includes('search'), 'Match content should contain search term')
    })

    console.log('✅ Grep tool test passed - agent-cli produces OpenCode-compatible JSON format')
    console.log('Actual output structure validated against expected OpenCode format')
  } finally {
    // Clean up
    try {
      unlinkSync(file1)
      unlinkSync(file2)
    } catch (e) {
      // Ignore cleanup errors
    }
  }
})