import { test, expect, setDefaultTimeout } from 'bun:test'
import { $ } from 'bun'
import { spawn } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'

// Increase default timeout to 30 seconds for these tests
setDefaultTimeout(30000)

// Helper to run agent-cli using spawn
async function runAgentCli(input) {
  return new Promise((resolve, reject) => {
    const proc = spawn('bun', ['run', join(process.cwd(), 'src/index.js')], {
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code })
    })

    proc.on('error', reject)

    // Write input and close stdin
    proc.stdin.write(input)
    proc.stdin.end()
  })
}

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
  // Path may be in input or may be empty object if default path used

  // Validate output - OpenCode returns formatted text, not JSON
  expect(typeof toolEvent.part.state.output).toBe('string')
  expect(toolEvent.part.state.output.includes('ls-test')).toBeTruthy()

  // Validate metadata structure
  expect(toolEvent.part.state.metadata).toBeTruthy()
  expect(typeof toolEvent.part.state.metadata.count).toBe('number')
  expect(typeof toolEvent.part.state.metadata.truncated).toBe('boolean')

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
    // const projectRoot = process.cwd()
    // const agentResult = await $`echo ${input} | bun run ${projectRoot}/src/index.js`.quiet()
    const agentResult = await runAgentCli(input)
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

    // Input may vary - AI can choose to omit default path or include it
    // Just verify both have input objects
    expect(typeof agentTool.part.state.input).toBe('object')
    expect(typeof originalTool.part.state.input).toBe('object')

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