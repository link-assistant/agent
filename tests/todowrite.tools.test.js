import { test, expect } from 'bun:test'
import { $ } from 'bun'

// Shared assertion function to validate OpenCode-compatible JSON structure for todoread tool
function validateTodoreadToolOutput(toolEvent, label) {
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
  expect(toolEvent.part.tool).toBe('todoread')

  // Validate state structure
  expect(toolEvent.part.state).toBeTruthy()
  expect(toolEvent.part.state.status).toBe('completed')
  expect(typeof toolEvent.part.state.title).toBe('string')

  // Validate input structure
  expect(toolEvent.part.state.input).toBeTruthy()

  // Validate output
  expect(typeof toolEvent.part.state.output).toBe('string')
  const output = JSON.parse(toolEvent.part.state.output)
  expect(output.todos).toBeTruthy()
  expect(Array.isArray(output.todos)).toBeTruthy()
  expect(output.todos.length).toBe(2)
  expect(output.todos[0].content).toBe('Test task 1')
  expect(output.todos[1].content).toBe('Test task 2')

  // Validate timing information
  expect(toolEvent.part.state.time).toBeTruthy()
  expect(typeof toolEvent.part.state.time.start).toBe('number')
  expect(typeof toolEvent.part.state.time.end).toBe('number')
  expect(toolEvent.part.state.time.end >= toolEvent.part.state.time.start).toBeTruthy()

  console.log(`✅ ${label} structure validation passed`)
}

test('Reference test: OpenCode tool produces expected JSON format', async () => {
  // Write and read todos in the same request
  const input = `{"message":"manage todos","tools":[{"name":"todowrite","params":{"todos":[{"content":"Test task 1","status":"pending","priority":"high","id":"test1"},{"content":"Test task 2","status":"completed","priority":"low","id":"test2"}]}},{"name":"todoread","params":{}}]}`
  const originalResult = await $`echo ${input} | opencode run --format json --model opencode/grok-code`.quiet().nothrow()
  const originalLines = originalResult.stdout.toString().trim().split('\n').filter(line => line.trim())
  const originalEvents = originalLines.map(line => JSON.parse(line))

  // Find tool_use events
  const originalToolEvents = originalEvents.filter(e => e.type === 'tool_use' && e.part.tool === 'todoread')

  // Should have tool_use events for todoread
  expect(originalToolEvents.length > 0).toBeTruthy()

  // Check the structure matches OpenCode format
  const originalTool = originalToolEvents[0]

  // Validate using shared assertion function
  validateTodoreadToolOutput(originalTool, 'OpenCode')

  console.log('✅ Reference test passed - OpenCode produces expected JSON format')
})

console.log('This establishes the baseline behavior for compatibility testing')

test('Agent-cli todowrite and todoread tools produce 100% compatible JSON output with OpenCode', async () => {
  // Write and read todos in the same request
  const input = `{"message":"manage todos","tools":[{"name":"todowrite","params":{"todos":[{"content":"Test task 1","status":"pending","priority":"high","id":"test1"},{"content":"Test task 2","status":"completed","priority":"low","id":"test2"}]}},{"name":"todoread","params":{}}]}`

  // Get OpenCode output
  const originalResult = await $`echo ${input} | opencode run --format json --model opencode/grok-code`.quiet().nothrow()
  const originalLines = originalResult.stdout.toString().trim().split('\n').filter(line => line.trim())
  const originalEvents = originalLines.map(line => JSON.parse(line))
  const originalTool = originalEvents.find(e => e.type === 'tool_use' && e.part.tool === 'todoread')

  // Get agent-cli output
  const projectRoot = process.cwd()
  const agentResult = await $`echo ${input} | bun run ${projectRoot}/src/index.js`.quiet()
  const agentLines = agentResult.stdout.toString().trim().split('\n').filter(line => line.trim())
  const agentEvents = agentLines.map(line => JSON.parse(line))
  const agentTool = agentEvents.find(e => e.type === 'tool_use' && e.part.tool === 'todoread')

  // Validate both outputs using shared assertion function
  validateTodoreadToolOutput(originalTool, 'OpenCode')
  validateTodoreadToolOutput(agentTool, 'Agent-cli')

  // Verify structure has same keys at all levels
  expect(Object.keys(agentTool).sort()).toEqual(Object.keys(originalTool).sort())
  expect(Object.keys(agentTool.part).sort()).toEqual(Object.keys(originalTool.part).sort())
  expect(Object.keys(agentTool.part.state).sort()).toEqual(Object.keys(originalTool.part.state).sort())

  // Input should match (empty object)
  expect(Object.keys(agentTool.part.state.input).sort()).toEqual(Object.keys(originalTool.part.state.input).sort())

  // Output should contain the same todos
  expect(agentTool.part.state.output).toBe(originalTool.part.state.output)

  expect(Object.keys(agentTool.part.state.time).sort()).toEqual(Object.keys(originalTool.part.state.time).sort())

  console.log('\n✅ Agent-cli produces 100% OpenCode-compatible JSON structure')
  console.log('All required fields and nested structure match OpenCode output format')
})