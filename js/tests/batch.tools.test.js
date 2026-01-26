import { test, expect, setDefaultTimeout } from 'bun:test';
import { $ } from 'bun';
import { spawn } from 'child_process';
import { join } from 'path';

// Disable timeouts for these tests
setDefaultTimeout(0);

// Helper to run opencode using spawn with batch_tool config
async function runOpenCode(input, tmpDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'opencode',
      ['run', '--format', 'json', '--model', 'opencode/grok-code'],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: tmpDir,
      }
    );

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

// Shared assertion function to validate OpenCode-compatible JSON structure for batch tool
function validateBatchToolOutput(toolEvent, label) {
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
  expect(toolEvent.part.tool).toBe('batch');

  // Validate state structure
  expect(toolEvent.part.state).toBeTruthy();
  expect(toolEvent.part.state.status).toBe('completed');
  expect(typeof toolEvent.part.state.title).toBe('string');

  // Validate input structure
  expect(toolEvent.part.state.input).toBeTruthy();
  expect(Array.isArray(toolEvent.part.state.input.tool_calls)).toBeTruthy();

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

console.log('This establishes the baseline behavior for compatibility testing');

test.skip('Reference test: OpenCode batch tool produces expected JSON format', async () => {
  const input = `{"message":"run batch","tools":[{"name":"batch","params":{"tool_calls":[{"tool":"bash","parameters":{"command":"echo hello","description":"Echo hello"}},{"tool":"bash","parameters":{"command":"echo world","description":"Echo world"}}]}}]}`;

  console.log('Starting opencode batch test...');

  // Create temporary config for OpenCode with batch_tool enabled
  const tmpDir = `/tmp/opencode-test-${Date.now()}`;
  await $`mkdir -p ${tmpDir}/.link-assistant-agent`.quiet();
  await $`echo '{"experimental":{"batch_tool":true}}' > ${tmpDir}/.link-assistant-agent/opencode.json`.quiet();

  // Use spawn instead of Bun $ to properly handle the command
  const originalResult = await runOpenCode(input, tmpDir);

  console.log('Command finished. Exit code:', originalResult.exitCode);
  console.log('Stdout length:', originalResult.stdout.length);
  console.log('Stderr length:', originalResult.stderr.length);

  const originalLines = originalResult.stdout
    .trim()
    .split('\n')
    .filter((line) => line.trim());
  console.log('Number of output lines:', originalLines.length);

  const originalEvents = originalLines.map((line) => JSON.parse(line));
  console.log(
    'Event types:',
    originalEvents.map((e) => e.type)
  );

  // Clean up
  await $`rm -rf ${tmpDir}`.quiet();

  // Find tool_use events for batch
  const batchEvent = originalEvents.find(
    (e) => e.type === 'tool_use' && e.part.tool === 'batch'
  );

  console.log('Found batch event:', !!batchEvent);

  // Should have tool_use event for batch
  expect(batchEvent).toBeTruthy();

  // Validate using shared assertion function
  validateBatchToolOutput(batchEvent, 'OpenCode');

  console.log(
    '✅ Reference test passed - OpenCode produces expected JSON format'
  );
});

test('Agent-cli batch tool produces valid JSON output', async () => {
  const input = `{"message":"run batch","tools":[{"name":"batch","params":{"tool_calls":[{"tool":"bash","parameters":{"command":"echo hello","description":"Echo hello"}},{"tool":"bash","parameters":{"command":"echo world","description":"Echo world"}}]}}]}`;

  console.log('Getting agent-cli output...');
  // Get agent-cli output using spawn (batch tool is now always enabled)
  const agentResult = await runAgentCli(input);
  const agentLines = agentResult.stdout
    .trim()
    .split('\n')
    .filter((line) => line.trim());
  const agentEvents = agentLines.map((line) => JSON.parse(line));
  const agentBatch = agentEvents.find(
    (e) => e.type === 'tool_use' && e.part.tool === 'batch'
  );

  // Validate output structure
  validateBatchToolOutput(agentBatch, 'Agent-cli');

  console.log('\n✅ Agent-cli produces valid JSON structure for batch tool');
  console.log('Batch tool executed successfully');
});
