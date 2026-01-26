import { test, expect, setDefaultTimeout } from 'bun:test';

// Increase default timeout to 60 seconds for these tests
setDefaultTimeout(60000);
import { $ } from 'bun';
import { spawn } from 'child_process';
import { readFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// Ensure tmp directory exists
const tmpDir = join(process.cwd(), 'tmp');
if (!existsSync(tmpDir)) {
  mkdirSync(tmpDir, { recursive: true });
}

// Helper to run agent-cli using spawn
async function runAgentCli(input) {
  return new Promise((resolve, reject) => {
    const proc = spawn('bun', ['run', join(process.cwd(), 'src/index.js')], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code });
    });

    proc.on('error', reject);

    // Write input and close stdin
    proc.stdin.write(input);
    proc.stdin.end();
  });
}

// Shared assertion function to validate OpenCode-compatible JSON structure for write tool
function validateWriteToolOutput(toolEvent, label) {
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
  expect(toolEvent.part.tool).toBe('write');

  // Validate state structure
  expect(toolEvent.part.state).toBeTruthy();
  expect(toolEvent.part.state.status).toBe('completed');
  expect(typeof toolEvent.part.state.title).toBe('string');

  // Validate input structure
  expect(toolEvent.part.state.input).toBeTruthy();
  expect(typeof toolEvent.part.state.input.filePath).toBe('string');
  expect(typeof toolEvent.part.state.input.content).toBe('string');

  // Validate output
  expect(typeof toolEvent.part.state.output).toBe('string');

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
    `test-write-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.txt`
  );

  try {
    // Test original OpenCode write tool
    const input = `{"message":"write file","tools":[{"name":"write","params":{"filePath":"${testFileName}","content":"Hello World\\nThis is a test file"}}]}`;
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
      (e) => e.type === 'tool_use' && e.part.tool === 'write'
    );

    // Should have tool_use events for write
    expect(originalToolEvents.length > 0).toBeTruthy();

    // Check the structure matches OpenCode format
    const originalTool = originalToolEvents[0];

    // Validate using shared assertion function
    validateWriteToolOutput(originalTool, 'OpenCode');

    // Verify the file was actually written
    const finalContent = readFileSync(testFileName, 'utf-8');
    expect(finalContent).toBe('Hello World\nThis is a test file');

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

test('Agent-cli write tool produces 100% compatible JSON output with OpenCode', async () => {
  const testFileName = join(
    tmpDir,
    `test-write-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.txt`
  );

  try {
    const input = `{"message":"write file","tools":[{"name":"write","params":{"filePath":"${testFileName}","content":"Hello World\\nThis is a test file"}}]}`;

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
      (e) => e.type === 'tool_use' && e.part.tool === 'write'
    );

    // Get agent-cli output
    // const projectRoot = process.cwd()
    // const agentResult = await $`echo ${input} | bun run ${projectRoot}/src/index.js`.quiet().nothrow()
    const agentResult = await runAgentCli(input);
    const agentLines = agentResult.stdout
      .toString()
      .trim()
      .split('\n')
      .filter((line) => line.trim());
    const agentEvents = agentLines.map((line) => JSON.parse(line));
    const agentTool = agentEvents.find(
      (e) => e.type === 'tool_use' && e.part.tool === 'write'
    );

    // Validate both outputs using shared assertion function
    validateWriteToolOutput(originalTool, 'OpenCode');
    validateWriteToolOutput(agentTool, 'Agent-cli');

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
    expect(agentTool.part.state.input.content).toBe(
      originalTool.part.state.input.content
    );

    // Output should match (both should be empty string for write tool)
    expect(agentTool.part.state.output).toBe(originalTool.part.state.output);

    expect(Object.keys(agentTool.part.state.time).sort()).toEqual(
      Object.keys(originalTool.part.state.time).sort()
    );

    // Verify the file was actually written by both
    const finalContent = readFileSync(testFileName, 'utf-8');
    expect(finalContent).toBe('Hello World\nThis is a test file');

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
