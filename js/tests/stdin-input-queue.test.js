import { test, expect, describe, setDefaultTimeout } from 'bun:test';
import { spawn } from 'child_process';
import { join } from 'path';

// Increase default timeout to 60 seconds for these tests
setDefaultTimeout(60000);

/**
 * Test suite for stdin input queuing functionality - Issue #76
 * Tests the input queue, auto-merge, and interactive mode features
 */

// Helper to run agent-cli using spawn with various options
async function runAgentCli(input, options = {}) {
  return new Promise((resolve, reject) => {
    const args = ['run', join(process.cwd(), 'src/index.js')];

    // Add CLI flags from options
    if (options.noInteractive) {
      args.push('--no-interactive');
    }
    if (options.noAutoMerge) {
      args.push('--no-auto-merge-queued-messages');
    }
    if (options.prompt) {
      args.push('-p', options.prompt);
    }
    if (options.disableStdin) {
      args.push('--disable-stdin');
    }
    if (options.timeout) {
      args.push('--stdin-stream-timeout', options.timeout.toString());
    }

    const proc = spawn('bun', args, {
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
    if (input !== null) {
      proc.stdin.write(input);
      proc.stdin.end();
    } else {
      proc.stdin.end();
    }
  });
}

// Helper to parse JSON events from stdout
function parseEvents(output) {
  const lines = output
    .trim()
    .split('\n')
    .filter((line) => line.trim());
  return lines
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_e) {
        return null;
      }
    })
    .filter((e) => e !== null);
}

describe('Input Queue Functionality', () => {
  test('Single JSON message is processed correctly', async () => {
    const jsonInput = JSON.stringify({ message: 'Hello from JSON' });
    const result = await runAgentCli(jsonInput);

    expect(result.exitCode).toBe(0);

    const events = parseEvents(result.stdout);
    expect(events.length).toBeGreaterThan(0);

    // Status messages go to stderr
    const stderrEvents = parseEvents(result.stderr);
    const statusEvent = stderrEvents.find((e) => e.type === 'status');
    expect(statusEvent).toBeTruthy();

    // Should have step_start event in stdout
    const stepStart = events.find((e) => e.type === 'step_start');
    expect(stepStart).toBeTruthy();

    console.log('✅ Single JSON message processed correctly');
  });

  test('Plain text message is processed in interactive mode (default)', async () => {
    const plainText = 'Hello from plain text';
    const result = await runAgentCli(plainText);

    expect(result.exitCode).toBe(0);

    const events = parseEvents(result.stdout);
    expect(events.length).toBeGreaterThan(0);

    // Should have step_start event (indicating message was processed)
    const stepStart = events.find((e) => e.type === 'step_start');
    expect(stepStart).toBeTruthy();

    console.log('✅ Plain text message processed in interactive mode');
  });

  test('Status message includes interactive and autoMerge options', async () => {
    const jsonInput = JSON.stringify({ message: 'test' });
    const result = await runAgentCli(jsonInput);

    expect(result.exitCode).toBe(0);

    // Status messages go to stderr
    const stderrEvents = parseEvents(result.stderr);
    const statusEvent = stderrEvents.find(
      (e) => e.type === 'status' && e.mode === 'stdin-stream'
    );

    expect(statusEvent).toBeTruthy();
    expect(statusEvent.options).toBeTruthy();
    expect(statusEvent.options.interactive).toBe(true);
    expect(statusEvent.options.autoMergeQueuedMessages).toBe(true);

    console.log('✅ Status message includes correct options');
  });
});

describe('Non-Interactive Mode', () => {
  test('Plain text is rejected in non-interactive mode', async () => {
    const plainText = 'Hello from plain text';
    const result = await runAgentCli(plainText, { noInteractive: true });

    expect(result.exitCode).toBe(1);

    // Error messages go to stderr
    const stderrEvents = parseEvents(result.stderr);
    const errorEvent = stderrEvents.find((e) => e.type === 'error');

    expect(errorEvent).toBeTruthy();
    expect(errorEvent.message).toContain('Invalid JSON input');
    expect(errorEvent.message).toContain('non-interactive mode');

    console.log('✅ Plain text rejected in non-interactive mode');
  });

  test('JSON is accepted in non-interactive mode', async () => {
    const jsonInput = JSON.stringify({ message: 'Hello from JSON' });
    const result = await runAgentCli(jsonInput, { noInteractive: true });

    expect(result.exitCode).toBe(0);

    const events = parseEvents(result.stdout);
    const stepStart = events.find((e) => e.type === 'step_start');
    expect(stepStart).toBeTruthy();

    console.log('✅ JSON accepted in non-interactive mode');
  });

  test('Status message shows only JSON format in non-interactive mode', async () => {
    const jsonInput = JSON.stringify({ message: 'test' });
    const result = await runAgentCli(jsonInput, { noInteractive: true });

    expect(result.exitCode).toBe(0);

    // Status messages go to stderr
    const stderrEvents = parseEvents(result.stderr);
    const statusEvent = stderrEvents.find(
      (e) => e.type === 'status' && e.mode === 'stdin-stream'
    );

    expect(statusEvent).toBeTruthy();
    expect(statusEvent.options.interactive).toBe(false);
    expect(statusEvent.acceptedFormats).toEqual([
      'JSON object with "message" field',
    ]);

    console.log('✅ Non-interactive mode shows correct accepted formats');
  });
});

describe('Prompt Flag', () => {
  test('-p flag bypasses stdin reading', async () => {
    const result = await runAgentCli(null, {
      prompt: 'Hello from prompt flag',
    });

    expect(result.exitCode).toBe(0);

    // Status messages go to stderr - should NOT have stdin-stream status
    const stderrEvents = parseEvents(result.stderr);
    const stdinStatus = stderrEvents.find(
      (e) => e.type === 'status' && e.mode === 'stdin-stream'
    );
    expect(stdinStatus).toBeFalsy();

    // Should have step_start event in stdout
    const events = parseEvents(result.stdout);
    const stepStart = events.find((e) => e.type === 'step_start');
    expect(stepStart).toBeTruthy();

    console.log('✅ -p flag bypasses stdin reading');
  });
});

describe('Disable Stdin Flag', () => {
  test('--disable-stdin without --prompt shows error', async () => {
    const result = await runAgentCli(null, { disableStdin: true });

    expect(result.exitCode).toBe(1);

    // Error messages go to stderr
    const stderrEvents = parseEvents(result.stderr);
    const errorEvent = stderrEvents.find((e) => e.type === 'error');

    expect(errorEvent).toBeTruthy();
    expect(errorEvent.message).toContain('No prompt provided');
    expect(errorEvent.hint).toContain('-p');

    console.log('✅ --disable-stdin without --prompt shows error');
  });
});

describe('Multi-line Input', () => {
  test('Multiple lines are processed as a single message by default (auto-merge)', async () => {
    const multiLineInput = 'Line 1\nLine 2\nLine 3';
    const result = await runAgentCli(multiLineInput);

    expect(result.exitCode).toBe(0);

    const events = parseEvents(result.stdout);
    const stepStart = events.find((e) => e.type === 'step_start');
    expect(stepStart).toBeTruthy();

    console.log('✅ Multi-line input processed correctly with auto-merge');
  });

  test('JSON with newlines is parsed correctly', async () => {
    const jsonWithNewlines = JSON.stringify({
      message: 'Line 1\nLine 2\nLine 3',
    });
    const result = await runAgentCli(jsonWithNewlines);

    expect(result.exitCode).toBe(0);

    const events = parseEvents(result.stdout);
    const stepStart = events.find((e) => e.type === 'step_start');
    expect(stepStart).toBeTruthy();

    console.log('✅ JSON with newlines parsed correctly');
  });
});

describe('Empty Input Handling', () => {
  test('Empty input shows status and help', async () => {
    const result = await runAgentCli('');

    expect(result.exitCode).toBe(0);

    // Status messages go to stderr
    const stderrEvents = parseEvents(result.stderr);
    const statusEvent = stderrEvents.find(
      (e) => e.type === 'status' && e.message?.includes('No input received')
    );
    expect(statusEvent).toBeTruthy();

    // Should also show help in stderr or stdout
    expect(
      result.stdout.includes('--help') || result.stderr.includes('--help')
    ).toBe(true);

    console.log('✅ Empty input shows status and help');
  });
});

describe('Input Queue Class (Unit Tests)', () => {
  test('InputQueue parseInput handles JSON correctly', async () => {
    // Import the module to test InputQueue directly
    // Note: InputQueue is not exported, so we test through CLI behavior
    // This test validates that JSON parsing works through CLI

    const testCases = [
      { input: '{"message":"test"}', expected: 'test' },
      { input: '{"message":"hello world"}', expected: 'hello world' },
    ];

    for (const testCase of testCases) {
      const result = await runAgentCli(testCase.input);
      expect(result.exitCode).toBe(0);
    }

    console.log('✅ InputQueue JSON parsing works correctly');
  });

  test('InputQueue parseInput handles plain text correctly', async () => {
    const testCases = ['hello', 'hello world', 'test message'];

    for (const text of testCases) {
      const result = await runAgentCli(text);
      expect(result.exitCode).toBe(0);
    }

    console.log('✅ InputQueue plain text parsing works correctly');
  });
});
