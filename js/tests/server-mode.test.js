import { test, expect, setDefaultTimeout } from 'bun:test';
import { spawn } from 'child_process';
import { join } from 'path';

// Increase default timeout to 60 seconds for these tests
setDefaultTimeout(60000);

// Helper function to parse JSON output (handles pretty-printed format)
function parseJSONOutput(stdout) {
  const trimmed = stdout.trim();
  const events = [];
  let currentJson = '';
  let braceCount = 0;

  for (const line of trimmed.split('\n')) {
    for (const char of line) {
      if (char === '{') {
        braceCount++;
      }
      if (char === '}') {
        braceCount--;
      }
      currentJson += char;

      if (braceCount === 0 && currentJson.trim()) {
        try {
          events.push(JSON.parse(currentJson.trim()));
          currentJson = '';
        } catch (_e) {
          // Continue accumulating
        }
      }
    }
    currentJson += '\n';
  }

  return events;
}

// Helper to run agent-cli with specified options
async function runAgentCli(input, args = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'bun',
      ['run', join(process.cwd(), 'src/index.js'), ...args],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
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

// Helper to check server start messages in stderr/log output
function _checkForServerStart(stderr) {
  // The Server.listen() call would typically produce log messages or errors
  // In server mode, we expect to see server-related activity
  const serverIndicators = [
    'Server.listen',
    'server.listen',
    'listening on',
    'Server started',
    'port',
  ];

  return serverIndicators.some((indicator) =>
    stderr.toLowerCase().includes(indicator.toLowerCase())
  );
}

// Shared assertion function to validate message output
function validateMessageOutput(events, label) {
  console.log(`\n${label} validation:`);

  // Should have events
  expect(events.length > 0).toBeTruthy();

  // Check for step_start event
  const startEvents = events.filter((e) => e.type === 'step_start');
  expect(startEvents.length > 0).toBeTruthy();

  // Check for step_finish event
  const finishEvents = events.filter((e) => e.type === 'step_finish');
  expect(finishEvents.length > 0).toBeTruthy();

  // Check for text event (the AI response)
  const textEvents = events.filter((e) => e.type === 'text');
  expect(textEvents.length > 0).toBeTruthy();
  expect(textEvents[0].part.text.length > 0).toBeTruthy();

  // Validate event structure
  for (const event of events) {
    expect(typeof event.type).toBe('string');
    expect(typeof event.timestamp).toBe('number');
    expect(typeof event.sessionID).toBe('string');
    expect(event.sessionID.startsWith('ses_')).toBeTruthy();
    expect(event.part).toBeTruthy();
    expect(typeof event.part.id).toBe('string');
    expect(event.part.id.startsWith('prt_')).toBeTruthy();
  }

  console.log(`✅ ${label} validation passed - ${events.length} events`);
  return events;
}

test('Server mode (default) works correctly', async () => {
  const input = '{"message":"What is 2+2?"}';
  const result = await runAgentCli(input);

  expect(result.exitCode).toBe(0);

  const events = parseJSONOutput(result.stdout);
  validateMessageOutput(events, 'Server mode');

  // Check that the response contains "4"
  const textEvents = events.filter((e) => e.type === 'text');
  const responseText = textEvents[0].part.text;
  expect(responseText.includes('4')).toBeTruthy();

  console.log(`Server mode response: ${responseText}`);
});

test('Server mode with explicit --server=true works correctly', async () => {
  const input = '{"message":"What is 3+3?"}';
  const result = await runAgentCli(input, ['--server=true']);

  expect(result.exitCode).toBe(0);

  const events = parseJSONOutput(result.stdout);
  validateMessageOutput(events, 'Server mode (explicit)');

  // Check that the response contains "6"
  const textEvents = events.filter((e) => e.type === 'text');
  const responseText = textEvents[0].part.text;
  expect(responseText.includes('6')).toBeTruthy();

  console.log(`Server mode (explicit) response: ${responseText}`);
});

test('No-server mode (--no-server) works correctly', async () => {
  const input = '{"message":"What is 5+5?"}';
  const result = await runAgentCli(input, ['--no-server']);

  expect(result.exitCode).toBe(0);

  const events = parseJSONOutput(result.stdout);
  validateMessageOutput(events, 'No-server mode');

  // Check that the response contains "10"
  const textEvents = events.filter((e) => e.type === 'text');
  const responseText = textEvents[0].part.text;
  expect(responseText.includes('10')).toBeTruthy();

  console.log(`No-server mode response: ${responseText}`);
});

test('Both modes produce equivalent output structure', async () => {
  const input = '{"message":"Say hi"}';

  // Run in server mode
  const serverResult = await runAgentCli(input, ['--server=true']);
  const serverEvents = parseJSONOutput(serverResult.stdout);

  // Run in no-server mode
  const noServerResult = await runAgentCli(input, ['--no-server']);
  const noServerEvents = parseJSONOutput(noServerResult.stdout);

  // Both should succeed
  expect(serverResult.exitCode).toBe(0);
  expect(noServerResult.exitCode).toBe(0);

  // Validate both outputs
  validateMessageOutput(serverEvents, 'Server mode');
  validateMessageOutput(noServerEvents, 'No-server mode');

  // Both should have the same event types
  const serverEventTypes = new Set(serverEvents.map((e) => e.type));
  const noServerEventTypes = new Set(noServerEvents.map((e) => e.type));

  expect(serverEventTypes.has('step_start')).toBeTruthy();
  expect(noServerEventTypes.has('step_start')).toBeTruthy();

  expect(serverEventTypes.has('text')).toBeTruthy();
  expect(noServerEventTypes.has('text')).toBeTruthy();

  expect(serverEventTypes.has('step_finish')).toBeTruthy();
  expect(noServerEventTypes.has('step_finish')).toBeTruthy();

  // Both should have text responses
  const serverTextEvents = serverEvents.filter((e) => e.type === 'text');
  const noServerTextEvents = noServerEvents.filter((e) => e.type === 'text');

  expect(serverTextEvents.length > 0).toBeTruthy();
  expect(noServerTextEvents.length > 0).toBeTruthy();

  console.log('\n✅ Both modes produce equivalent output structure');
  console.log(
    `Server mode events: ${serverEvents.length}, No-server mode events: ${noServerEvents.length}`
  );
  console.log(`Server mode text: "${serverTextEvents[0].part.text}"`);
  console.log(`No-server mode text: "${noServerTextEvents[0].part.text}"`);
});

test('Both modes handle the same mathematical question identically', async () => {
  const input = '{"message":"What is 7+8?"}';

  // Run in server mode
  const serverResult = await runAgentCli(input, ['--server=true']);
  const serverEvents = parseJSONOutput(serverResult.stdout);

  // Run in no-server mode
  const noServerResult = await runAgentCli(input, ['--no-server']);
  const noServerEvents = parseJSONOutput(noServerResult.stdout);

  // Both should succeed
  expect(serverResult.exitCode).toBe(0);
  expect(noServerResult.exitCode).toBe(0);

  // Both should have the same answer
  const serverTextEvents = serverEvents.filter((e) => e.type === 'text');
  const noServerTextEvents = noServerEvents.filter((e) => e.type === 'text');

  const serverText = serverTextEvents[0].part.text;
  const noServerText = noServerTextEvents[0].part.text;

  // Both should contain "15"
  expect(serverText.includes('15')).toBeTruthy();
  expect(noServerText.includes('15')).toBeTruthy();

  console.log(
    '\n✅ Both modes produce the same answer to mathematical questions'
  );
  console.log(`Server mode: "${serverText}"`);
  console.log(`No-server mode: "${noServerText}"`);
});

test('Both modes work with plain text input', async () => {
  const input = 'What is the capital of France?';

  // Run in server mode
  const serverResult = await runAgentCli(input, ['--server=true']);
  const serverEvents = parseJSONOutput(serverResult.stdout);

  // Run in no-server mode
  const noServerResult = await runAgentCli(input, ['--no-server']);
  const noServerEvents = parseJSONOutput(noServerResult.stdout);

  // Both should succeed
  expect(serverResult.exitCode).toBe(0);
  expect(noServerResult.exitCode).toBe(0);

  // Validate both outputs
  validateMessageOutput(serverEvents, 'Server mode (plain text)');
  validateMessageOutput(noServerEvents, 'No-server mode (plain text)');

  // Both should mention Paris
  const serverTextEvents = serverEvents.filter((e) => e.type === 'text');
  const noServerTextEvents = noServerEvents.filter((e) => e.type === 'text');

  const serverText = serverTextEvents[0].part.text;
  const noServerText = noServerTextEvents[0].part.text;

  expect(serverText.toLowerCase().includes('paris')).toBeTruthy();
  expect(noServerText.toLowerCase().includes('paris')).toBeTruthy();

  console.log('\n✅ Both modes handle plain text input correctly');
  console.log(`Server mode: "${serverText}"`);
  console.log(`No-server mode: "${noServerText}"`);
});

test('Both modes work with custom model parameter', async () => {
  const input = '{"message":"hi"}';

  // Run both modes with explicit model
  const serverResult = await runAgentCli(input, [
    '--server=true',
    '--model',
    'opencode/grok-code',
  ]);
  const noServerResult = await runAgentCli(input, [
    '--no-server',
    '--model',
    'opencode/grok-code',
  ]);

  // Both should succeed
  expect(serverResult.exitCode).toBe(0);
  expect(noServerResult.exitCode).toBe(0);

  const serverEvents = parseJSONOutput(serverResult.stdout);
  const noServerEvents = parseJSONOutput(noServerResult.stdout);

  // Validate both outputs
  validateMessageOutput(serverEvents, 'Server mode (custom model)');
  validateMessageOutput(noServerEvents, 'No-server mode (custom model)');

  console.log('\n✅ Both modes work with custom model parameter');
});

test('Verify code execution path: server mode calls Server.listen', async () => {
  const { readFileSync } = await import('fs');
  const indexPath = join(process.cwd(), 'src/index.js');
  const indexCode = readFileSync(indexPath, 'utf-8');

  // Verify that the code has separate paths for server and no-server modes
  expect(indexCode.includes('if (argv.server)')).toBeTruthy();
  expect(indexCode.includes('runServerMode()')).toBeTruthy();
  expect(indexCode.includes('runDirectMode()')).toBeTruthy();

  // Verify server mode calls Server.listen
  expect(indexCode.includes('Server.listen')).toBeTruthy();

  // Verify runServerMode has Server.listen call
  const serverModeStart = indexCode.indexOf('async function runServerMode()');
  const serverModeEnd = indexCode.indexOf('async function runDirectMode()');
  const serverModeCode = indexCode.substring(serverModeStart, serverModeEnd);
  expect(serverModeCode.includes('Server.listen')).toBeTruthy();
  expect(serverModeCode.includes('server.stop()')).toBeTruthy();

  // Verify runDirectMode does NOT have Server.listen call
  const directModeFunctionEnd = indexCode.indexOf(
    '// Explicitly exit',
    serverModeEnd
  );
  const directModeFunctionCode = indexCode.substring(
    serverModeEnd,
    directModeFunctionEnd
  );
  expect(directModeFunctionCode.includes('Server.listen')).toBeFalsy();
  expect(directModeFunctionCode.includes('Session.createNext')).toBeTruthy();
  expect(directModeFunctionCode.includes('SessionPrompt.prompt')).toBeTruthy();

  console.log('\n✅ Code verification passed:');
  console.log('  - Server mode path calls Server.listen()');
  console.log('  - No-server mode path does NOT call Server.listen()');
  console.log(
    '  - No-server mode uses Session.createNext() and SessionPrompt.prompt()'
  );
});

test('Verify no HTTP fetch calls in no-server mode execution path', async () => {
  const { readFileSync } = await import('fs');
  const indexPath = join(process.cwd(), 'src/index.js');
  const indexCode = readFileSync(indexPath, 'utf-8');

  // Extract the runDirectMode function
  const directModeStart = indexCode.indexOf('async function runDirectMode()');
  const directModeEnd = indexCode.indexOf(
    '// Explicitly exit',
    directModeStart
  );
  const directModeCode = indexCode.substring(directModeStart, directModeEnd);

  // Verify no HTTP calls in direct mode
  expect(directModeCode.includes('http://')).toBeFalsy();
  expect(directModeCode.includes('fetch(`http')).toBeFalsy();

  // Verify server mode DOES use HTTP
  const serverModeStart = indexCode.indexOf('async function runServerMode()');
  const serverModeCode = indexCode.substring(serverModeStart, directModeStart);
  expect(serverModeCode.includes('http://')).toBeTruthy();
  expect(serverModeCode.includes('fetch(')).toBeTruthy();

  console.log('\n✅ HTTP usage verification passed:');
  console.log('  - Server mode uses HTTP fetch for communication');
  console.log('  - No-server mode has NO HTTP calls (direct API usage)');
});
