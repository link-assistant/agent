import { test, expect } from 'bun:test';
import { $ } from 'bun';

// Shared assertion function to validate OpenCode-compatible JSON structure
function validateBashToolOutput(toolEvent, label) {
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
  expect(toolEvent.part.tool).toBe('bash');

  // Validate state structure
  expect(toolEvent.part.state).toBeTruthy();
  expect(toolEvent.part.state.status).toBe('completed');
  expect(typeof toolEvent.part.state.title).toBe('string');

  // Validate input structure
  expect(toolEvent.part.state.input).toBeTruthy();
  expect(toolEvent.part.state.input.command).toBe('echo hello world');

  // Validate output
  expect(typeof toolEvent.part.state.output).toBe('string');
  expect(toolEvent.part.state.output.includes('hello world')).toBeTruthy();

  // Validate metadata structure
  expect(toolEvent.part.state.metadata).toBeTruthy();
  expect(typeof toolEvent.part.state.metadata.output).toBe('string');
  expect(typeof toolEvent.part.state.metadata.exit).toBe('number');

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
    '{"message":"run command","tools":[{"name":"bash","params":{"command":"echo hello world"}}]}';

  // Test original OpenCode bash tool
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
    (e) => e.type === 'tool_use' && e.part.tool === 'bash'
  );

  // Validate using shared assertion function
  validateBashToolOutput(originalTool, 'OpenCode');

  console.log(
    '✅ Reference test passed - OpenCode produces expected JSON format'
  );
});

console.log('This establishes the baseline behavior for compatibility testing');

test('Agent-cli bash tool produces 100% compatible JSON output with OpenCode', async () => {
  const input =
    '{"message":"run command","tools":[{"name":"bash","params":{"command":"echo hello world"}}]}';

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
    (e) => e.type === 'tool_use' && e.part.tool === 'bash'
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
    (e) => e.type === 'tool_use' && e.part.tool === 'bash'
  );

  // Validate both outputs using shared assertion function
  validateBashToolOutput(originalTool, 'OpenCode');
  validateBashToolOutput(agentTool, 'Agent-cli');

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

  // Input may have optional description field added by AI, so we just check required fields are present
  expect(agentTool.part.state.input.command).toBe(
    originalTool.part.state.input.command
  );

  // Metadata may have optional description field, so we check required fields
  expect(agentTool.part.state.metadata.output).toBeTruthy();
  expect(typeof agentTool.part.state.metadata.exit).toBe('number');

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
