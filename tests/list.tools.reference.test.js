import { test, assert } from 'test-anywhere'
// @ts-ignore
import { sh } from 'command-stream'
import { writeFileSync, unlinkSync } from 'fs'

test('Agent-cli list tool produces OpenCode-compatible JSON output', async () => {
  const timestamp = Date.now()
  const randomId = Math.random().toString(36).substr(2, 9)

  // Create test files with unique names
  const file1 = `ls-test1-${timestamp}-${randomId}.txt`
  const file2 = `ls-test2-${timestamp}-${randomId}.txt`

  writeFileSync(file1, 'content1')
  writeFileSync(file2, 'content2')

  try {
    // Test our agent-cli list tool (compatible with OpenCode ls tool)
    const projectRoot = process.cwd()
    const input = `{"message":"list files","tools":[{"name":"list","params":{"path":"."}}]}`
    const agentResult = await sh(`echo '${input}' | bun run ${projectRoot}/src/index.js`)
    const agentLines = agentResult.stdout.trim().split('\n').filter(line => line.trim())
    const agentEvents = agentLines.map(line => JSON.parse(line))

    // Document expected OpenCode JSON structure for ls tool
    console.log('Expected OpenCode JSON event structure for ls tool:')
    console.log('{"type":"tool_use","timestamp":1234567890,"sessionID":"ses_xxx","part":{"tool":"ls","state":{"status":"completed","input":{"path":"."},"output":{"items":[{"name":"file.txt","type":"file","size":123,"modified":"2023-..." }]}}}}')

    // Find tool_use events
    const agentToolEvents = agentEvents.filter(e => e.type === 'tool_use' && e.part.tool === 'list')

    // Should have tool_use events
    assert.ok(agentToolEvents.length > 0, 'Agent should have list tool_use events')

    // Check the structure matches OpenCode format
    const agentTool = agentToolEvents[0]

    // Validate top-level structure
    assert.equal(typeof agentTool.type, 'string', 'Event should have type field')
    assert.equal(agentTool.type, 'tool_use', 'Event type should be tool_use')
    assert.equal(typeof agentTool.timestamp, 'number', 'Event should have timestamp')
    assert.equal(typeof agentTool.sessionID, 'string', 'Event should have sessionID')

    // Validate part structure
    assert.ok(agentTool.part, 'Event should have part object')
    assert.equal(agentTool.part.tool, 'list', 'Part tool should be list')
    assert.equal(agentTool.part.type, 'tool', 'Part type should be tool')

    // Validate state structure
    assert.ok(agentTool.part.state, 'Part should have state object')
    assert.equal(agentTool.part.state.status, 'completed', 'Tool status should be completed')
    assert.equal(typeof agentTool.part.state.title, 'string', 'State should have title')
    assert.ok(agentTool.part.state.input, 'State should have input')
    assert.equal(typeof agentTool.part.state.input.path, 'string', 'Input should have path')
    assert.equal(typeof agentTool.part.state.output, 'string', 'State should have output')

    // Validate timing information
    assert.ok(agentTool.part.time, 'Part should have time object')
    assert.equal(typeof agentTool.part.time.start, 'number', 'Time should have start timestamp')
    assert.equal(typeof agentTool.part.time.end, 'number', 'Time should have end timestamp')

    // Check that output contains file listings
    const agentOutput = JSON.parse(agentTool.part.state.output)
    assert.ok(agentOutput.items, 'Should have items array')
    assert.ok(Array.isArray(agentOutput.items), 'Items should be an array')
    assert.ok(agentOutput.items.some(item => item.name.includes('ls-test')), 'Should list test files')

    // Validate item structure
    agentOutput.items.forEach(item => {
      assert.equal(typeof item.name, 'string', 'Item should have name')
      assert.ok(['file', 'directory'].includes(item.type), 'Item should have valid type')
      assert.equal(typeof item.size, 'number', 'Item should have size')
      assert.ok(item.modified, 'Item should have modified date')
    })

    console.log('✅ List tool test passed - agent-cli produces OpenCode-compatible JSON format')
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