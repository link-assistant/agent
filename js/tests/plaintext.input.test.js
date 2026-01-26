import { test, expect, setDefaultTimeout } from 'bun:test';
import { spawn } from 'child_process';
import { join } from 'path';

// Increase default timeout to 60 seconds for these tests
setDefaultTimeout(60000);

// Helper to run agent-cli using spawn
async function runAgentCli(input) {
  return new Promise((resolve, reject) => {
    const proc = spawn('bun', ['run', join(process.cwd(), 'src/index.js')], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, AGENT_CLI_COMPACT: '1' },
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

test('Agent-cli accepts plain text input and converts to message', async () => {
  const plainTextInput = 'Hello, how are you?';

  const result = await runAgentCli(plainTextInput);

  expect(result.exitCode).toBe(0);

  const lines = result.stdout
    .trim()
    .split('\n')
    .filter((line) => line.trim());
  const events = lines.map((line) => JSON.parse(line));

  // Should have at least a step_start and text response
  expect(events.length).toBeGreaterThan(0);

  // Should have a step_start event
  const stepStart = events.find((e) => e.type === 'step_start');
  expect(stepStart).toBeTruthy();

  // Should have a text response event
  const textEvent = events.find((e) => e.type === 'text');
  expect(textEvent).toBeTruthy();
  expect(typeof textEvent.part.text).toBe('string');

  console.log(
    '✅ Plain text input successfully converted to message and processed'
  );
});

test('Agent-cli still accepts JSON input', async () => {
  const jsonInput = JSON.stringify({
    message: 'test message',
    tools: [{ name: 'bash', params: { command: 'echo test' } }],
  });

  const result = await runAgentCli(jsonInput);

  expect(result.exitCode).toBe(0);

  const lines = result.stdout
    .trim()
    .split('\n')
    .filter((line) => line.trim());
  const events = lines.map((line) => JSON.parse(line));

  // Should have tool_use event for bash
  const toolEvent = events.find(
    (e) => e.type === 'tool_use' && e.part.tool === 'bash'
  );
  expect(toolEvent).toBeTruthy();

  console.log('✅ JSON input still works correctly');
});

test('OpenCode handles plain text input (for comparison)', async () => {
  const plainTextInput = 'Hello, how are you?';

  return new Promise((resolve, reject) => {
    const proc = spawn(
      'opencode',
      ['run', '--format', 'json', '--model', 'opencode/grok-code'],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    let stdout = '';
    let _stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      _stderr += data.toString();
    });

    proc.on('close', (code) => {
      try {
        // OpenCode should either reject plain text or handle it gracefully
        if (code === 0) {
          const lines = stdout
            .trim()
            .split('\n')
            .filter((line) => line.trim());
          if (lines.length > 0) {
            // Try to parse first line to see if it's valid JSON
            const firstEvent = JSON.parse(lines[0]);
            expect(firstEvent.type).toBeTruthy();
            console.log(
              '✅ OpenCode accepts plain text and produces JSON output'
            );
          }
        } else {
          // OpenCode rejects plain text - this is also acceptable behavior
          console.log('ℹ️  OpenCode requires JSON input format');
        }
        resolve();
      } catch (err) {
        reject(err);
      }
    });

    proc.on('error', reject);

    // Write input and close stdin
    proc.stdin.write(plainTextInput);
    proc.stdin.end();
  });
});
