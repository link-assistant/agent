import { test, expect, setDefaultTimeout } from 'bun:test';
import { $ } from 'bun';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// Increase default timeout to 60 seconds for these tests
setDefaultTimeout(60000);

// Ensure tmp directory exists
const tmpDir = join(process.cwd(), 'tmp');
if (!existsSync(tmpDir)) {
  mkdirSync(tmpDir, { recursive: true });
}

// Shared assertion function to validate OpenCode-compatible JSON structure for read tool
function validateReadToolOutput(toolEvent, label) {
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
  expect(toolEvent.part.tool).toBe('read');

  // Validate state structure
  expect(toolEvent.part.state).toBeTruthy();
  expect(toolEvent.part.state.status).toBe('completed');
  expect(typeof toolEvent.part.state.title).toBe('string');

  // Validate input structure
  expect(toolEvent.part.state.input).toBeTruthy();
  expect(typeof toolEvent.part.state.input.filePath).toBe('string');

  // Validate output
  expect(typeof toolEvent.part.state.output).toBe('string');
  expect(
    toolEvent.part.state.output.includes('This is test content')
  ).toBeTruthy();

  // Validate metadata structure
  expect(toolEvent.part.state.metadata).toBeTruthy();
  expect(typeof toolEvent.part.state.metadata.preview).toBe('string');

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
  const testFileName = join(
    tmpDir,
    `test-read-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.txt`
  );

  // Create a test file in tmp directory
  writeFileSync(testFileName, 'This is test content for reading\n');

  try {
    // Test original OpenCode read tool
    const input = `{"message":"read file","tools":[{"name":"read","params":{"filePath":"${testFileName}"}}]}`;
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
      (e) => e.type === 'tool_use' && e.part.tool === 'read'
    );

    // Should have tool_use events for read
    expect(originalToolEvents.length > 0).toBeTruthy();

    // Check the structure matches OpenCode format
    const originalTool = originalToolEvents[0];

    // Validate using shared assertion function
    validateReadToolOutput(originalTool, 'OpenCode');

    console.log(
      '✅ Reference test passed - OpenCode produces expected JSON format'
    );
  } finally {
    // Clean up
    try {
      unlinkSync(testFileName);
    } catch (_e) {
      // Ignore cleanup errors
    }
  }
});

console.log('This establishes the baseline behavior for compatibility testing');

test('Agent-cli read tool produces 100% compatible JSON output with OpenCode', async () => {
  const testFileName = join(
    tmpDir,
    `test-read-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.txt`
  );

  // Create a test file in tmp directory
  writeFileSync(testFileName, 'This is test content for reading\n');

  try {
    const input = `{"message":"read file","tools":[{"name":"read","params":{"filePath":"${testFileName}"}}]}`;

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
      (e) => e.type === 'tool_use' && e.part.tool === 'read'
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
      (e) => e.type === 'tool_use' && e.part.tool === 'read'
    );

    // Validate both outputs using shared assertion function
    validateReadToolOutput(originalTool, 'OpenCode');
    validateReadToolOutput(agentTool, 'Agent-cli');

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
    expect(agentTool.part.state.input.filePath).toBe(
      originalTool.part.state.input.filePath
    );

    // Output should contain the same content
    expect(agentTool.part.state.output).toBe(originalTool.part.state.output);

    expect(Object.keys(agentTool.part.state.time).sort()).toEqual(
      Object.keys(originalTool.part.state.time).sort()
    );

    console.log(
      '\n✅ Agent-cli produces 100% OpenCode-compatible JSON structure'
    );
    console.log(
      'All required fields and nested structure match OpenCode output format'
    );
  } finally {
    // Clean up
    try {
      unlinkSync(testFileName);
    } catch (_e) {
      // Ignore cleanup errors
    }
  }
});
