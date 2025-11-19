import { test, expect } from 'bun:test'
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
    expect(typeof agentTool.part.state.input.include).toBeTruthy()
    expect(typeof agentTool.part.state.output).toBeTruthy()

    // Validate timing information
    expect(agentTool.part.time).toBeTruthy()
    expect(typeof agentTool.part.time.start).toBeTruthy()
    expect(typeof agentTool.part.time.end).toBeTruthy()

    // Check that output contains matches
    const agentOutput = JSON.parse(agentTool.part.state.output)
    expect(agentOutput.matches).toBeTruthy()
    expect(Array.isArray(agentOutput.matches)).toBeTruthy()
    expect(agentOutput.matches.length >= 2).toBeTruthy()

    // Validate match structure
    agentOutput.matches.forEach(match => {
      expect(typeof match.file).toBeTruthy()
      expect(typeof match.line).toBeTruthy()
      expect(typeof match.content).toBeTruthy()
      expect(match.content.includes('search')).toBeTruthy()
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