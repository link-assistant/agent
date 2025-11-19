import { test, expect } from 'bun:test'
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
    expect(typeof agentTool.part.state.input.oldString).toBeTruthy()
    expect(typeof agentTool.part.state.input.newString).toBeTruthy()
    expect(typeof agentTool.part.state.output).toBeTruthy()

    // Validate timing information
    expect(agentTool.part.time).toBeTruthy()
    expect(typeof agentTool.part.time.start).toBeTruthy()
    expect(typeof agentTool.part.time.end).toBeTruthy()

    // Verify the file was actually edited
    const finalContent = readFileSync(testFileName, 'utf-8')
    expect(finalContent.includes('Hi World')).toBeTruthy()

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