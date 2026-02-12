import { test, expect, setDefaultTimeout } from 'bun:test';
import { $ } from 'bun';
import { spawn } from 'child_process';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// Increase default timeout to 60 seconds for these tests
setDefaultTimeout(60000);

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

// Shared assertion function to validate OpenCode-compatible JSON structure for glob tool
function validateGlobToolOutput(toolEvent, label) {
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
  expect(toolEvent.part.tool).toBe('glob');

  // Validate state structure
  expect(toolEvent.part.state).toBeTruthy();
  expect(toolEvent.part.state.status).toBe('completed');
  expect(typeof toolEvent.part.state.title).toBe('string');

  // Validate input structure
  expect(toolEvent.part.state.input).toBeTruthy();
  expect(typeof toolEvent.part.state.input.pattern).toBe('string');

  // Validate output - OpenCode returns newline-separated file paths or "No files found"
  expect(typeof toolEvent.part.state.output).toBe('string');

  if (toolEvent.part.state.output !== 'No files found') {
    const matches = toolEvent.part.state.output
      .trim()
      .split('\n')
      .filter((line) => line.trim());

    // Validate that matches are strings (file paths)
    matches.forEach((match) => {
      expect(typeof match).toBe('string');
      expect(match.length > 0).toBeTruthy();
    });
  }

  // Validate metadata structure
  expect(toolEvent.part.state.metadata).toBeTruthy();
  expect(typeof toolEvent.part.state.metadata.count).toBe('number');
  expect(typeof toolEvent.part.state.metadata.truncated).toBe('boolean');

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
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substr(2, 9);

  // Create test files with unique names in tmp directory
  const file1 = join(tmpDir, `test1-${timestamp}-${randomId}.txt`);
  const file2 = join(tmpDir, `test2-${timestamp}-${randomId}.txt`);
  const file3 = join(tmpDir, `other-${timestamp}-${randomId}.js`);

  writeFileSync(file1, 'content1');
  writeFileSync(file2, 'content2');
  writeFileSync(file3, 'javascript');

  try {
    // Test original OpenCode glob tool
    const input = `{"message":"find txt files","tools":[{"name":"glob","params":{"pattern":"tmp/test*-${timestamp}-${randomId}.txt"}}]}`;
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
      (e) => e.type === 'tool_use' && e.part.tool === 'glob'
    );

    // Should have tool_use events for glob
    expect(originalToolEvents.length > 0).toBeTruthy();

    // Check the structure matches OpenCode format
    const originalTool = originalToolEvents[0];

    // Validate using shared assertion function
    validateGlobToolOutput(originalTool, 'OpenCode');

    console.log(
      '✅ Reference test passed - OpenCode produces expected JSON format'
    );
  } finally {
    // Clean up
    try {
      unlinkSync(file1);
      unlinkSync(file2);
      unlinkSync(file3);
    } catch (_e) {
      // Ignore cleanup errors
    }
  }
});

console.log('This establishes the baseline behavior for compatibility testing');

test('Agent-cli glob tool produces 100% compatible JSON output with OpenCode', async () => {
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substr(2, 9);

  // Create test files with unique names in tmp directory
  const file1 = join(tmpDir, `test1-${timestamp}-${randomId}.txt`);
  const file2 = join(tmpDir, `test2-${timestamp}-${randomId}.txt`);
  const file3 = join(tmpDir, `other-${timestamp}-${randomId}.js`);

  writeFileSync(file1, 'content1');
  writeFileSync(file2, 'content2');
  writeFileSync(file3, 'javascript');

  try {
    const input = `{"message":"find txt files","tools":[{"name":"glob","params":{"pattern":"tmp/test*-${timestamp}-${randomId}.txt"}}]}`;

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
      (e) => e.type === 'tool_use' && e.part.tool === 'glob'
    );

    // Get agent-cli output
    // const projectRoot = process.cwd()
    // const agentResult = await $`echo ${input} | bun run ${projectRoot}/src/index.js`.quiet()
    const agentResult = await runAgentCli(input);
    const agentLines = agentResult.stdout
      .toString()
      .trim()
      .split('\n')
      .filter((line) => line.trim());
    const agentEvents = agentLines.map((line) => JSON.parse(line));
    const agentTool = agentEvents.find(
      (e) => e.type === 'tool_use' && e.part.tool === 'glob'
    );

    // Validate both outputs using shared assertion function
    validateGlobToolOutput(originalTool, 'OpenCode');
    validateGlobToolOutput(agentTool, 'Agent-cli');

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

    // Input pattern is specified in the test and should match the request
    expect(agentTool.part.state.input.pattern).toContain(timestamp.toString());
    expect(agentTool.part.state.input.pattern).toContain(randomId);

    // Output should contain similar matches
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
  } finally {
    // Clean up
    try {
      unlinkSync(file1);
      unlinkSync(file2);
      unlinkSync(file3);
    } catch (_e) {
      // Ignore cleanup errors
    }
  }
});
