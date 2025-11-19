import { test, expect } from 'bun:test'
import { $ } from 'bun'
import { writeFileSync, unlinkSync } from 'fs'

// Shared assertion function to validate OpenCode-compatible JSON structure for list tool
function validateListToolOutput(toolEvent, label) {
  console.log(`\n${label} JSON structure:`)
  console.log(JSON.stringify(toolEvent, null, 2))

  // Validate top-level structure
  expect(typeof toolEvent.type).toBe('string')
  expect(toolEvent.type).toBe('tool_use')
  expect(typeof toolEvent.timestamp).toBe('number')
  expect(typeof toolEvent.sessionID).toBe('string')
  expect(toolEvent.sessionID.startsWith('ses_')).toBeTruthy()

  // Validate part structure
  expect(toolEvent.part).toBeTruthy()
  expect(typeof toolEvent.part.id).toBe('string')
  expect(toolEvent.part.id.startsWith('prt_')).toBeTruthy()
  expect(typeof toolEvent.part.sessionID).toBe('string')
  expect(typeof toolEvent.part.messageID).toBe('string')
  expect(toolEvent.part.type).toBe('tool')
  expect(typeof toolEvent.part.callID).toBe('string')
  expect(toolEvent.part.callID.startsWith('call_')).toBeTruthy()
  expect(toolEvent.part.tool).toBe('list')

  // Validate state structure
  expect(toolEvent.part.state).toBeTruthy()
  expect(toolEvent.part.state.status).toBe('completed')
  expect(typeof toolEvent.part.state.title).toBe('string')

  // Validate input structure
  expect(toolEvent.part.state.input).toBeTruthy()
  expect(typeof toolEvent.part.state.input.path).toBe('string')

  // Validate output
  expect(typeof toolEvent.part.state.output).toBe('string')
  const output = JSON.parse(toolEvent.part.state.output)
  expect(output.items).toBeTruthy()
  expect(Array.isArray(output.items)).toBeTruthy()
  expect(output.items.some(item => item.name.includes('ls-test'))).toBeTruthy()

  // Validate item structure
  output.items.forEach(item => {
    expect(typeof item.name).toBe('string')
    expect(typeof item.type).toBe('string')
    expect(typeof item.size).toBe('number')
    expect(typeof item.modified).toBe('string')
  })

  // Validate timing information
  expect(toolEvent.part.state.time).toBeTruthy()
  expect(typeof toolEvent.part.state.time.start).toBe('number')
  expect(typeof toolEvent.part.state.time.end).toBe('number')
  expect(toolEvent.part.state.time.end >= toolEvent.part.state.time.start).toBeTruthy()

  console.log(`✅ ${label} structure validation passed`)
}

test('Reference test: OpenCode tool produces expected JSON format', async () => {
  const timestamp = Date.now()
  const randomId = Math.random().toString(36).substr(2, 9)

  // Create test files with unique names
  const file1 = `ls-test1-${timestamp}-${randomId}.txt`
  const file2 = `ls-test2-${timestamp}-${randomId}.txt`

  writeFileSync(file1, 'content1')
  writeFileSync(file2, 'content2')

  try {
    // Test original OpenCode list tool
    const input = `{"message":"list files","tools":[{"name":"list","params":{"path":"."}}]}`
    const originalResult = await $`echo ${input} | opencode run --format json --model opencode/grok-code`.quiet().nothrow()
    const originalLines = originalResult.stdout.toString().trim().split('\n').filter(line => line.trim())
    const originalEvents = originalLines.map(line => JSON.parse(line))

    // Find tool_use events
    const originalToolEvents = originalEvents.filter(e => e.type === 'tool_use' && e.part.tool === 'list')

    // Should have tool_use events
    expect(originalToolEvents.length > 0).toBeTruthy()

    // Check the structure matches OpenCode format
    const originalTool = originalToolEvents[0]

    // Validate using shared assertion function
    validateListToolOutput(originalTool, 'OpenCode')

    console.log('✅ Reference test passed - OpenCode produces expected JSON format')
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

console.log('This establishes the baseline behavior for compatibility testing')

test('Agent-cli list tool produces 100% compatible JSON output with OpenCode', async () => {
  const timestamp = Date.now()
  const randomId = Math.random().toString(36).substr(2, 9)

  // Create test files with unique names
  const file1 = `ls-test1-${timestamp}-${randomId}.txt`
  const file2 = `ls-test2-${timestamp}-${randomId}.txt`

  writeFileSync(file1, 'content1')
  writeFileSync(file2, 'content2')

  try {
    const input = `{"message":"list files","tools":[{"name":"list","params":{"path":"."}}]}`

    // Get OpenCode output
    const originalResult = await $`echo ${input} | opencode run --format json --model opencode/grok-code`.quiet().nothrow()
    const originalLines = originalResult.stdout.toString().trim().split('\n').filter(line => line.trim())
    const originalEvents = originalLines.map(line => JSON.parse(line))
    const originalTool = originalEvents.find(e => e.type === 'tool_use' && e.part.tool === 'list')

    // Get agent-cli output
    const projectRoot = process.cwd()
    const agentResult = await $`echo ${input} | bun run ${projectRoot}/src/index.js`.quiet()
    const agentLines = agentResult.stdout.toString().trim().split('\n').filter(line => line.trim())
    const agentEvents = agentLines.map(line => JSON.parse(line))
    const agentTool = agentEvents.find(e => e.type === 'tool_use' && e.part.tool === 'list')

    // Validate both outputs using shared assertion function
    validateListToolOutput(originalTool, 'OpenCode')
    validateListToolOutput(agentTool, 'Agent-cli')

    // Verify structure has same keys at all levels
    expect(Object.keys(agentTool).sort()).toEqual(Object.keys(originalTool).sort())
    expect(Object.keys(agentTool.part).sort()).toEqual(Object.keys(originalTool.part).sort())
    expect(Object.keys(agentTool.part.state).sort()).toEqual(Object.keys(originalTool.part.state).sort())

    // Input should match
    expect(agentTool.part.state.input.path).toBe(originalTool.part.state.input.path)

    // Output should contain similar file listings
    expect(agentTool.part.state.output).toBeTruthy()

    expect(Object.keys(agentTool.part.state.time).sort()).toEqual(Object.keys(originalTool.part.state.time).sort())

    console.log('\n✅ Agent-cli produces 100% OpenCode-compatible JSON structure')
    console.log('All required fields and nested structure match OpenCode output format')
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