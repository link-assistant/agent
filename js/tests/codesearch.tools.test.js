import { test, expect, setDefaultTimeout } from 'bun:test';
// $ imported for consistency with other tests
import { spawn } from 'child_process';
import { join } from 'path';

// Disable timeouts for these tests
setDefaultTimeout(0);

// Helper to run opencode using spawn
async function runOpenCode(input) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'opencode',
      ['run', '--format', 'json', '--model', 'opencode/grok-code'],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, OPENCODE_EXPERIMENTAL_EXA: 'true' },
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

// Shared assertion function to validate OpenCode-compatible JSON structure for codesearch tool
function validateCodeSearchToolOutput(toolEvent, label) {
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
  expect(toolEvent.part.tool).toBe('codesearch');

  // Validate state structure
  expect(toolEvent.part.state).toBeTruthy();
  expect(toolEvent.part.state.status).toBe('completed');
  expect(typeof toolEvent.part.state.title).toBe('string');

  // Validate input structure
  expect(toolEvent.part.state.input).toBeTruthy();
  expect(typeof toolEvent.part.state.input.query).toBe('string');

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

test('Reference test: OpenCode codesearch tool produces expected JSON format', async () => {
  const input = `{"message":"search code","tools":[{"name":"codesearch","params":{"query":"React hooks implementation"}}]}`;

  console.log('Starting opencode codesearch test...');

  // Use spawn instead of Bun $ to properly handle the command
  const originalResult = await runOpenCode(input);

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

  // Find tool_use events for codesearch
  const searchEvent = originalEvents.find(
    (e) => e.type === 'tool_use' && e.part.tool === 'codesearch'
  );

  console.log('Found codesearch event:', !!searchEvent);

  // Should have tool_use event for codesearch
  expect(searchEvent).toBeTruthy();

  // Validate using shared assertion function
  validateCodeSearchToolOutput(searchEvent, 'OpenCode');

  console.log(
    '✅ Reference test passed - OpenCode produces expected JSON format'
  );
});

test('Agent-cli codesearch tool produces 100% compatible JSON output with OpenCode', async () => {
  const input = `{"message":"search code","tools":[{"name":"codesearch","params":{"query":"React hooks implementation"}}]}`;

  console.log('Getting OpenCode output...');
  // Get OpenCode output using spawn
  const originalResult = await runOpenCode(input);
  const originalLines = originalResult.stdout
    .trim()
    .split('\n')
    .filter((line) => line.trim());
  const originalEvents = originalLines.map((line) => JSON.parse(line));
  const originalSearch = originalEvents.find(
    (e) => e.type === 'tool_use' && e.part.tool === 'codesearch'
  );

  console.log('Getting agent-cli output...');
  // Get agent-cli output using spawn without OPENCODE_EXPERIMENTAL_EXA flag
  const agentResult = await runAgentCli(input);
  const agentLines = agentResult.stdout
    .trim()
    .split('\n')
    .filter((line) => line.trim());
  const agentEvents = agentLines.map((line) => JSON.parse(line));
  const agentSearch = agentEvents.find(
    (e) => e.type === 'tool_use' && e.part.tool === 'codesearch'
  );

  // Validate both outputs
  validateCodeSearchToolOutput(originalSearch, 'OpenCode');
  validateCodeSearchToolOutput(agentSearch, 'Agent-cli');

  // Verify structure matches
  expect(Object.keys(agentSearch).sort()).toEqual(
    Object.keys(originalSearch).sort()
  );
  expect(Object.keys(agentSearch.part).sort()).toEqual(
    Object.keys(originalSearch.part).sort()
  );
  expect(Object.keys(agentSearch.part.state).sort()).toEqual(
    Object.keys(originalSearch.part.state).sort()
  );

  console.log(
    '\n✅ Agent-cli produces 100% OpenCode-compatible JSON structure for codesearch tool'
  );
  console.log(
    'All required fields and nested structure match OpenCode output format'
  );
});
