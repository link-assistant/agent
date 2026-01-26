import { test, expect, setDefaultTimeout } from 'bun:test';
import { $ } from 'bun';
import { spawn } from 'child_process';
import {
  writeFileSync,
  readFileSync,
  unlinkSync,
  mkdirSync,
  existsSync,
} from 'fs';
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

// Shared assertion function to validate OpenCode-compatible JSON structure for edit tool
function validateEditToolOutput(toolEvent, label, testFileName) {
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
  expect(toolEvent.part.tool).toBe('edit');

  // Validate state structure
  expect(toolEvent.part.state).toBeTruthy();
  expect(toolEvent.part.state.status).toBe('completed');
  expect(typeof toolEvent.part.state.title).toBe('string');

  // Validate input structure
  expect(toolEvent.part.state.input).toBeTruthy();
  expect(typeof toolEvent.part.state.input.filePath).toBe('string');
  // FilePath can be relative or absolute, just check it ends with the test file name
  expect(
    toolEvent.part.state.input.filePath.endsWith(testFileName)
  ).toBeTruthy();
  expect(typeof toolEvent.part.state.input.oldString).toBe('string');
  expect(toolEvent.part.state.input.oldString).toBe('Hello');
  expect(typeof toolEvent.part.state.input.newString).toBe('string');
  expect(toolEvent.part.state.input.newString).toBe('Hi');

  // Validate output
  expect(typeof toolEvent.part.state.output).toBe('string');

  // Validate metadata structure (OpenCode returns complex diff metadata)
  expect(toolEvent.part.state.metadata).toBeTruthy();
  expect(typeof toolEvent.part.state.metadata.diagnostics).toBe('object');
  expect(typeof toolEvent.part.state.metadata.diff).toBe('string');
  expect(typeof toolEvent.part.state.metadata.filediff).toBe('object');
  expect(typeof toolEvent.part.state.metadata.filediff.file).toBe('string');
  expect(typeof toolEvent.part.state.metadata.filediff.before).toBe('string');
  expect(typeof toolEvent.part.state.metadata.filediff.after).toBe('string');
  expect(typeof toolEvent.part.state.metadata.filediff.additions).toBe(
    'number'
  );
  expect(typeof toolEvent.part.state.metadata.filediff.deletions).toBe(
    'number'
  );

  // Validate timing information
  expect(toolEvent.part.state.time).toBeTruthy();
  expect(typeof toolEvent.part.state.time.start).toBe('number');
  expect(typeof toolEvent.part.state.time.end).toBe('number');
  expect(
    toolEvent.part.state.time.end >= toolEvent.part.state.time.start
  ).toBeTruthy();

  console.log(`✅ ${label} structure validation passed`);
}

test('Reference test: OpenCode edit tool produces expected JSON format', async () => {
  const testFileName = join(
    tmpDir,
    `test-edit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.txt`
  );

  // Create a test file in tmp directory
  writeFileSync(testFileName, 'Hello World\n');

  try {
    // Test original OpenCode edit tool
    const input = `{"message":"edit file","tools":[{"name":"edit","params":{"filePath":"${testFileName}","oldString":"Hello","newString":"Hi"}}]}`;
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
      (e) => e.type === 'tool_use' && e.part.tool === 'edit'
    );

    // Validate using shared assertion function
    validateEditToolOutput(originalTool, 'OpenCode', testFileName);

    // Verify the file was actually edited
    const finalContent = readFileSync(testFileName, 'utf-8');
    expect(finalContent.includes('Hi World')).toBeTruthy();

    console.log(
      '✅ Reference test passed - OpenCode edit tool produces expected JSON format'
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

test('Agent-cli edit tool produces 100% compatible JSON output with OpenCode', async () => {
  const openCodeFileName = join(
    tmpDir,
    `test-edit-opencode-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.txt`
  );
  const agentFileName = join(
    tmpDir,
    `test-edit-agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.txt`
  );

  // Create separate test files for each tool in tmp directory
  writeFileSync(openCodeFileName, 'Hello World\n');
  writeFileSync(agentFileName, 'Hello World\n');

  try {
    // Get OpenCode output
    const openCodeInput = `{"message":"edit file","tools":[{"name":"edit","params":{"filePath":"${openCodeFileName}","oldString":"Hello","newString":"Hi"}}]}`;
    const originalResult =
      await $`echo ${openCodeInput} | opencode run --format json --model opencode/grok-code`
        .quiet()
        .nothrow();
    const originalLines = originalResult.stdout
      .toString()
      .trim()
      .split('\n')
      .filter((line) => line.trim());
    const originalEvents = originalLines.map((line) => JSON.parse(line));
    const originalTool = originalEvents.find(
      (e) => e.type === 'tool_use' && e.part.tool === 'edit'
    );

    // Get agent-cli output (using different file)
    // const projectRoot = process.cwd()
    const agentInput = `{"message":"edit file","tools":[{"name":"edit","params":{"filePath":"${agentFileName}","oldString":"Hello","newString":"Hi"}}]}`;
    // const agentResult = await $`echo ${agentInput} | bun run ${projectRoot}/src/index.js`.quiet()
    const agentResult = await runAgentCli(agentInput);
    const agentLines = agentResult.stdout
      .toString()
      .trim()
      .split('\n')
      .filter((line) => line.trim());
    const agentEvents = agentLines.map((line) => JSON.parse(line));
    const agentTool = agentEvents.find(
      (e) => e.type === 'tool_use' && e.part.tool === 'edit'
    );

    // Validate both outputs using shared assertion function
    validateEditToolOutput(originalTool, 'OpenCode', openCodeFileName);
    validateEditToolOutput(agentTool, 'Agent-cli', agentFileName);

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

    // Input fields should match
    expect(
      agentTool.part.state.input.filePath.endsWith(agentFileName)
    ).toBeTruthy();
    expect(
      originalTool.part.state.input.filePath.endsWith(openCodeFileName)
    ).toBeTruthy();
    expect(agentTool.part.state.input.oldString).toBe(
      originalTool.part.state.input.oldString
    );
    expect(agentTool.part.state.input.newString).toBe(
      originalTool.part.state.input.newString
    );

    // Metadata should have required fields (both should have the full structure)
    expect(Object.keys(agentTool.part.state.metadata).sort()).toEqual(
      Object.keys(originalTool.part.state.metadata).sort()
    );

    expect(Object.keys(agentTool.part.state.time).sort()).toEqual(
      Object.keys(originalTool.part.state.time).sort()
    );

    // Verify both files were actually edited
    const openCodeContent = readFileSync(openCodeFileName, 'utf-8');
    const agentContent = readFileSync(agentFileName, 'utf-8');
    expect(openCodeContent.includes('Hi World')).toBeTruthy();
    expect(agentContent.includes('Hi World')).toBeTruthy();

    console.log(
      '\n✅ Agent-cli produces 100% OpenCode-compatible JSON structure for edit tool'
    );
    console.log(
      'All required fields and nested structure match OpenCode output format'
    );
  } finally {
    // Clean up both files
    try {
      unlinkSync(openCodeFileName);
    } catch (_e) {
      // Ignore cleanup errors
    }
    try {
      unlinkSync(agentFileName);
    } catch (_e) {
      // Ignore cleanup errors
    }
  }
});
