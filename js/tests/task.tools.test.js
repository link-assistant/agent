import { test, expect, setDefaultTimeout } from 'bun:test';
import { $ } from 'bun';
import { spawn } from 'child_process';
import { join } from 'path';

// Increase default timeout to 60 seconds for these tests
setDefaultTimeout(60000);

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

// Shared assertion function to validate OpenCode-compatible JSON structure for task tool
function validateTaskToolOutput(toolEvent, label) {
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
  expect(toolEvent.part.tool).toBe('task');

  // Validate state structure
  expect(toolEvent.part.state).toBeTruthy();
  expect(toolEvent.part.state.status).toBe('completed');
  expect(typeof toolEvent.part.state.title).toBe('string');

  // Validate input structure
  expect(toolEvent.part.state.input).toBeTruthy();
  expect(typeof toolEvent.part.state.input.description).toBe('string');
  expect(typeof toolEvent.part.state.input.prompt).toBe('string');
  expect(typeof toolEvent.part.state.input.subagent_type).toBe('string');

  // Validate output - task actually runs and returns AI response
  expect(typeof toolEvent.part.state.output).toBe('string');
  expect(toolEvent.part.state.output.length > 0).toBeTruthy();

  // Validate metadata structure
  expect(toolEvent.part.state.metadata).toBeTruthy();
  expect(Array.isArray(toolEvent.part.state.metadata.summary)).toBeTruthy();
  expect(typeof toolEvent.part.state.metadata.sessionId).toBe('string');

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
    '{"message":"launch task","tools":[{"name":"task","params":{"description":"Test task","prompt":"Do something","subagent_type":"general"}}]}';

  // Test original OpenCode task tool
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
    (e) => e.type === 'tool_use' && e.part.tool === 'task'
  );

  // Should have tool_use events for task
  expect(originalToolEvents.length > 0).toBeTruthy();

  // Check the structure matches OpenCode format
  const originalTool = originalToolEvents[0];

  // Validate using shared assertion function
  validateTaskToolOutput(originalTool, 'OpenCode');

  console.log(
    '✅ Reference test passed - OpenCode produces expected JSON format'
  );
});

console.log('This establishes the baseline behavior for compatibility testing');

test('Agent-cli task tool produces 100% compatible JSON output with OpenCode', async () => {
  const input =
    '{"message":"launch task","tools":[{"name":"task","params":{"description":"Test task","prompt":"Do something","subagent_type":"general"}}]}';

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
    (e) => e.type === 'tool_use' && e.part.tool === 'task'
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
    (e) => e.type === 'tool_use' && e.part.tool === 'task'
  );

  // Validate both outputs using shared assertion function
  validateTaskToolOutput(originalTool, 'OpenCode');
  validateTaskToolOutput(agentTool, 'Agent-cli');

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
  expect(agentTool.part.state.input.description).toBe(
    originalTool.part.state.input.description
  );
  expect(agentTool.part.state.input.prompt).toBe(
    originalTool.part.state.input.prompt
  );
  expect(agentTool.part.state.input.subagent_type).toBe(
    originalTool.part.state.input.subagent_type
  );

  // Output should be similar
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
