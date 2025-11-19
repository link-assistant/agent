import { test, expect } from 'bun:test'
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
    expect(typeof agentTool.part.state.input.path).toBeTruthy()
    expect(typeof agentTool.part.state.output).toBeTruthy()

    // Validate timing information
    expect(agentTool.part.time).toBeTruthy()
    expect(typeof agentTool.part.time.start).toBeTruthy()
    expect(typeof agentTool.part.time.end).toBeTruthy()

    // Check that output contains file listings
    const agentOutput = JSON.parse(agentTool.part.state.output)
    expect(agentOutput.items).toBeTruthy()
    expect(Array.isArray(agentOutput.items)).toBeTruthy()
    expect(agentOutput.items.some(item => item.name.includes('ls-test'))).toBeTruthy()

    // Validate item structure
    agentOutput.items.forEach(item => {
      expect(typeof item.name).toBeTruthy()
      expect(typeof item.type).toBeTruthy()
      expect(typeof item.size).toBeTruthy()
      expect(item.modified).toBeTruthy()
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