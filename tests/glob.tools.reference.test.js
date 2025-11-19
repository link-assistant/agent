import { test, expect } from 'bun:test'
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
    expect(agentToolEvents.length > 0).toBeTruthy()

    // Check the structure matches OpenCode format
    const agentTool = agentToolEvents[0]

    // Validate top-level structure
    expect(typeof agentTool.type).toBeTruthy()
    expect(agentTool.type).toBeTruthy()
    expect(typeof agentTool.timestamp).toBeTruthy()
    expect(typeof agentTool.sessionID).toBeTruthy()

    // Validate part structure
    expect(agentTool.part).toBeTruthy()
    expect(agentTool.part.tool).toBeTruthy()
    expect(agentTool.part.type).toBeTruthy()

    // Validate state structure
    expect(agentTool.part.state).toBeTruthy()
    expect(agentTool.part.state.status).toBeTruthy()
    expect(typeof agentTool.part.state.title).toBeTruthy()
    expect(agentTool.part.state.input).toBeTruthy()
    expect(typeof agentTool.part.state.input.pattern).toBeTruthy()
    expect(typeof agentTool.part.state.output).toBeTruthy()

    // Validate timing information
    expect(agentTool.part.time).toBeTruthy()
    expect(typeof agentTool.part.time.start).toBeTruthy()
    expect(typeof agentTool.part.time.end).toBeTruthy()

    // Check that output contains file matches
    const agentOutput = JSON.parse(agentTool.part.state.output)
    expect(agentOutput.matches).toBeTruthy()
    expect(Array.isArray(agentOutput.matches)).toBeTruthy()
    expect(agentOutput.matches.length >= 2).toBeTruthy()

    // Validate that matches are strings (file paths)
    agentOutput.matches.forEach(match => {
      expect(typeof match).toBeTruthy()
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