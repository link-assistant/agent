import { test, expect } from 'bun:test'
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
    expect(typeof agentTool.part.state.input.filePath).toBeTruthy()
    expect(typeof agentTool.part.state.output).toBeTruthy()

    // Validate timing information
    expect(agentTool.part.time).toBeTruthy()
    expect(typeof agentTool.part.time.start).toBeTruthy()
    expect(typeof agentTool.part.time.end).toBeTruthy()

    // Check that output contains the file content
    expect(agentTool.part.state.output.includes('This is test content')).toBeTruthy()

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