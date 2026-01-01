import { test, expect, setDefaultTimeout } from 'bun:test';
import { $ } from 'bun';

// Disable timeouts for these tests
setDefaultTimeout(0);

// Shared assertion function to validate OpenCode-compatible JSON structure for todo tools
function validateTodoToolOutput(toolEvent, toolName, label) {
  console.log(`\n${label} ${toolName} JSON structure:`);
  console.log(JSON.stringify(toolEvent, null, 2));

  // Validate top-level structure
  expect(typeof toolEvent.type).toBe('string');
  expect(toolEvent.type).toBe('tool_use');
  expect(typeof toolEvent.timestamp).toBe('number');
  expect(typeof toolEvent.sessionID).toBe('string');
  expect(toolEvent.sessionID.startsWith('ses_')).toBeTruthy();

  // Validate part structure
  expect(toolEvent.part).toBeTruthy();
  expect(typeof toolEvent.part.id).toBe('string');
  expect(toolEvent.part.id.startsWith('prt_')).toBeTruthy();
  expect(typeof toolEvent.part.sessionID).toBe('string');
  expect(typeof toolEvent.part.messageID).toBe('string');
  expect(toolEvent.part.type).toBe('tool');
  expect(typeof toolEvent.part.callID).toBe('string');
  expect(toolEvent.part.callID.startsWith('call_')).toBeTruthy();
  expect(toolEvent.part.tool).toBe(toolName);

  // Validate state structure
  expect(toolEvent.part.state).toBeTruthy();
  expect(toolEvent.part.state.status).toBe('completed');
  expect(typeof toolEvent.part.state.title).toBe('string');

  // Validate input structure
  expect(toolEvent.part.state.input).toBeTruthy();

  // Validate output - output is a JSON array string
  expect(typeof toolEvent.part.state.output).toBe('string');
  const output = JSON.parse(toolEvent.part.state.output);
  expect(Array.isArray(output)).toBeTruthy();
  expect(output.length).toBe(2);
  expect(output[0].content).toBe('Test task 1');
  expect(output[1].content).toBe('Test task 2');

  // Also validate metadata.todos
  expect(toolEvent.part.state.metadata).toBeTruthy();
  expect(Array.isArray(toolEvent.part.state.metadata.todos)).toBeTruthy();
  expect(toolEvent.part.state.metadata.todos.length).toBe(2);

  // Validate timing information
  expect(toolEvent.part.state.time).toBeTruthy();
  expect(typeof toolEvent.part.state.time.start).toBe('number');
  expect(typeof toolEvent.part.state.time.end).toBe('number');
  expect(
    toolEvent.part.state.time.end >= toolEvent.part.state.time.start
  ).toBeTruthy();

  console.log(`✅ ${label} ${toolName} structure validation passed`);
}

console.log('This establishes the baseline behavior for compatibility testing');

test('Reference test: OpenCode todowrite and todoread tools produce expected JSON format', async () => {
  // Write and read todos in the same request
  const input = `{"message":"manage todos","tools":[{"name":"todowrite","params":{"todos":[{"content":"Test task 1","status":"pending","priority":"medium","id":"test1"},{"content":"Test task 2","status":"completed","priority":"medium","id":"test2"}]}},{"name":"todoread","params":{}}]}`;
  const originalResult =
    await $`echo ${input} | opencode run --format json --model opencode/grok-code`
      .quiet()
      .nothrow();
  const originalLines = originalResult.stdout
    .toString()
    .trim()
    .split('\n')
    .filter((line) => line.trim());
  const originalEvents = originalLines.map((line) => JSON.parse(line));

  // Find tool_use events for both todowrite and todoread
  const writeEvent = originalEvents.find(
    (e) => e.type === 'tool_use' && e.part.tool === 'todowrite'
  );
  const readEvent = originalEvents.find(
    (e) => e.type === 'tool_use' && e.part.tool === 'todoread'
  );

  // Should have tool_use events for both tools
  expect(writeEvent).toBeTruthy();
  expect(readEvent).toBeTruthy();

  // Validate both tools using shared assertion function
  validateTodoToolOutput(writeEvent, 'todowrite', 'OpenCode');
  validateTodoToolOutput(readEvent, 'todoread', 'OpenCode');

  console.log(
    '✅ Reference test passed - OpenCode produces expected JSON format for both tools'
  );
});

test('Agent-cli todowrite and todoread tools produce 100% compatible JSON output with OpenCode', async () => {
  // Write and read todos in the same request
  const input = `{"message":"manage todos","tools":[{"name":"todowrite","params":{"todos":[{"content":"Test task 1","status":"pending","priority":"medium","id":"test1"},{"content":"Test task 2","status":"completed","priority":"medium","id":"test2"}]}},{"name":"todoread","params":{}}]}`;

  // Get OpenCode output
  const originalResult =
    await $`echo ${input} | opencode run --format json --model opencode/grok-code`
      .quiet()
      .nothrow();
  const originalLines = originalResult.stdout
    .toString()
    .trim()
    .split('\n')
    .filter((line) => line.trim());
  const originalEvents = originalLines.map((line) => JSON.parse(line));
  const originalWrite = originalEvents.find(
    (e) => e.type === 'tool_use' && e.part.tool === 'todowrite'
  );
  const originalRead = originalEvents.find(
    (e) => e.type === 'tool_use' && e.part.tool === 'todoread'
  );

  // Get agent-cli output
  const projectRoot = process.cwd();
  const agentResult =
    await $`echo ${input} | bun run ${projectRoot}/src/index.js`.quiet();
  const agentLines = agentResult.stdout
    .toString()
    .trim()
    .split('\n')
    .filter((line) => line.trim());
  const agentEvents = agentLines.map((line) => JSON.parse(line));
  const agentWrite = agentEvents.find(
    (e) => e.type === 'tool_use' && e.part.tool === 'todowrite'
  );
  const agentRead = agentEvents.find(
    (e) => e.type === 'tool_use' && e.part.tool === 'todoread'
  );

  // Validate all outputs using shared assertion function
  validateTodoToolOutput(originalWrite, 'todowrite', 'OpenCode');
  validateTodoToolOutput(originalRead, 'todoread', 'OpenCode');
  validateTodoToolOutput(agentWrite, 'todowrite', 'Agent-cli');
  validateTodoToolOutput(agentRead, 'todoread', 'Agent-cli');

  // Verify todowrite structure matches
  expect(Object.keys(agentWrite).sort()).toEqual(
    Object.keys(originalWrite).sort()
  );
  expect(Object.keys(agentWrite.part).sort()).toEqual(
    Object.keys(originalWrite.part).sort()
  );
  expect(Object.keys(agentWrite.part.state).sort()).toEqual(
    Object.keys(originalWrite.part.state).sort()
  );
  expect(agentWrite.part.state.output).toBe(originalWrite.part.state.output);
  expect(Object.keys(agentWrite.part.state.metadata).sort()).toEqual(
    Object.keys(originalWrite.part.state.metadata).sort()
  );

  // Verify todoread structure matches
  expect(Object.keys(agentRead).sort()).toEqual(
    Object.keys(originalRead).sort()
  );
  expect(Object.keys(agentRead.part).sort()).toEqual(
    Object.keys(originalRead.part).sort()
  );
  expect(Object.keys(agentRead.part.state).sort()).toEqual(
    Object.keys(originalRead.part.state).sort()
  );
  expect(agentRead.part.state.output).toBe(originalRead.part.state.output);
  expect(Object.keys(agentRead.part.state.metadata).sort()).toEqual(
    Object.keys(originalRead.part.state.metadata).sort()
  );

  console.log(
    '\n✅ Agent-cli produces 100% OpenCode-compatible JSON structure for both todowrite and todoread'
  );
  console.log(
    'All required fields and nested structure match OpenCode output format'
  );
});
