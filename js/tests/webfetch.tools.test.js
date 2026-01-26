import { test, expect, setDefaultTimeout } from 'bun:test';
import { $ } from 'bun';

// Disable timeouts for these tests
setDefaultTimeout(0);

// Shared assertion function to validate OpenCode-compatible JSON structure for webfetch tool
function validateWebfetchToolOutput(toolEvent, label) {
  console.log(`\n${label} JSON structure:`);
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
  expect(toolEvent.part.tool).toBe('webfetch');

  // Validate state structure
  expect(toolEvent.part.state).toBeTruthy();
  expect(toolEvent.part.state.status).toBe('completed');
  expect(typeof toolEvent.part.state.title).toBe('string');

  // Validate input structure
  expect(toolEvent.part.state.input).toBeTruthy();
  expect(typeof toolEvent.part.state.input.url).toBe('string');
  expect(typeof toolEvent.part.state.input.format).toBe('string');

  // Validate output
  expect(typeof toolEvent.part.state.output).toBe('string');
  expect(
    toolEvent.part.state.output.includes('<html>') ||
      toolEvent.part.state.output.includes('Herman Melville')
  ).toBeTruthy();

  // Validate timing information
  expect(toolEvent.part.state.time).toBeTruthy();
  expect(typeof toolEvent.part.state.time.start).toBe('number');
  expect(typeof toolEvent.part.state.time.end).toBe('number');
  expect(
    toolEvent.part.state.time.end >= toolEvent.part.state.time.start
  ).toBeTruthy();

  console.log(`✅ ${label} structure validation passed`);
}

test('Reference test: OpenCode tool produces expected JSON format', async () => {
  const input =
    '{"message":"fetch url","tools":[{"name":"webfetch","params":{"url":"https://httpbin.org/html","format":"html"}}]}';

  // Test original OpenCode webfetch tool
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

  // Find tool_use events
  const originalToolEvents = originalEvents.filter(
    (e) => e.type === 'tool_use' && e.part.tool === 'webfetch'
  );

  // Should have tool_use events for webfetch
  expect(originalToolEvents.length > 0).toBeTruthy();

  // Check the structure matches OpenCode format
  const originalTool = originalToolEvents[0];

  // Validate using shared assertion function
  validateWebfetchToolOutput(originalTool, 'OpenCode');

  console.log(
    '✅ Reference test passed - OpenCode produces expected JSON format'
  );
});

console.log('This establishes the baseline behavior for compatibility testing');

test('Agent-cli webfetch tool produces 100% compatible JSON output with OpenCode', async () => {
  const input =
    '{"message":"fetch url","tools":[{"name":"webfetch","params":{"url":"https://httpbin.org/html","format":"html"}}]}';

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
  const originalTool = originalEvents.find(
    (e) => e.type === 'tool_use' && e.part.tool === 'webfetch'
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
  const agentTool = agentEvents.find(
    (e) => e.type === 'tool_use' && e.part.tool === 'webfetch'
  );

  // Validate both outputs using shared assertion function
  validateWebfetchToolOutput(originalTool, 'OpenCode');
  validateWebfetchToolOutput(agentTool, 'Agent-cli');

  // Verify structure has same keys at all levels
  expect(Object.keys(agentTool).sort()).toEqual(
    Object.keys(originalTool).sort()
  );
  expect(Object.keys(agentTool.part).sort()).toEqual(
    Object.keys(originalTool.part).sort()
  );
  expect(Object.keys(agentTool.part.state).sort()).toEqual(
    Object.keys(originalTool.part.state).sort()
  );

  // Input should match
  expect(agentTool.part.state.input.url).toBe(
    originalTool.part.state.input.url
  );
  expect(agentTool.part.state.input.format).toBe(
    originalTool.part.state.input.format
  );

  // Output should contain similar content
  expect(agentTool.part.state.output).toBeTruthy();

  expect(Object.keys(agentTool.part.state.time).sort()).toEqual(
    Object.keys(originalTool.part.state.time).sort()
  );

  console.log(
    '\n✅ Agent-cli produces 100% OpenCode-compatible JSON structure'
  );
  console.log(
    'All required fields and nested structure match OpenCode output format'
  );
});
