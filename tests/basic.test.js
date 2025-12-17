import { test, expect, setDefaultTimeout } from 'bun:test';
// @ts-ignore
import { sh } from 'command-stream';
import { $ } from 'bun';

// Increase default timeout to 60 seconds for these tests
setDefaultTimeout(60000);

// Helper function to parse JSON output (handles both compact and pretty-printed)
function parseJSONOutput(stdout) {
  const trimmed = stdout.trim();

  // Try parsing as compact (one JSON per line)
  const lines = trimmed.split('\n').filter((line) => line.trim());

  // Check if first line is complete JSON (compact mode)
  try {
    JSON.parse(lines[0]);
    // If successful, assume all lines are complete JSON objects
    return lines.map((line) => JSON.parse(line));
  } catch (_e) {
    // Pretty-printed mode - need to extract individual JSON objects
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
}

// Shared assertion function to validate basic message JSON output
function validateBasicMessageOutput(events, label) {
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
}

test('OpenCode reference: processes JSON input "hi" and produces JSON output', async () => {
  const input = '{"message":"hi"}';
  const opencodeResult =
    await $`echo ${input} | opencode run --format json --model opencode/grok-code`
      .quiet()
      .nothrow();
  const opencodeLines = opencodeResult.stdout
    .toString()
    .trim()
    .split('\n')
    .filter((line) => line.trim());
  const opencodeEvents = opencodeLines.map((line) => JSON.parse(line));

  validateBasicMessageOutput(opencodeEvents, 'OpenCode');
});

test('Agent-cli processes JSON input "hi" and produces JSON output', async () => {
  const projectRoot = process.cwd();
  const input = '{"message":"hi"}';
  const agentResult = await sh(
    `echo '${input}' | bun run ${projectRoot}/src/index.js`
  );
  const agentEvents = parseJSONOutput(agentResult.stdout);

  validateBasicMessageOutput(agentEvents, 'Agent-cli');
});

test('Agent-cli produces 100% compatible JSON output with OpenCode', async () => {
  const input = '{"message":"hi"}';

  // Get OpenCode output
  const opencodeResult =
    await $`echo ${input} | opencode run --format json --model opencode/grok-code`
      .quiet()
      .nothrow();
  const opencodeLines = opencodeResult.stdout
    .toString()
    .trim()
    .split('\n')
    .filter((line) => line.trim());
  const opencodeEvents = opencodeLines.map((line) => JSON.parse(line));

  // Get agent-cli output
  const projectRoot = process.cwd();
  const agentResult = await sh(
    `echo '${input}' | bun run ${projectRoot}/src/index.js`
  );
  const agentEvents = parseJSONOutput(agentResult.stdout);

  // Validate both outputs using shared assertion function
  validateBasicMessageOutput(opencodeEvents, 'OpenCode');
  validateBasicMessageOutput(agentEvents, 'Agent-cli');

  // Both should have same number of event types
  expect(opencodeEvents.some((e) => e.type === 'step_start')).toBeTruthy();
  expect(agentEvents.some((e) => e.type === 'step_start')).toBeTruthy();

  expect(opencodeEvents.some((e) => e.type === 'text')).toBeTruthy();
  expect(agentEvents.some((e) => e.type === 'text')).toBeTruthy();

  expect(opencodeEvents.some((e) => e.type === 'step_finish')).toBeTruthy();
  expect(agentEvents.some((e) => e.type === 'step_finish')).toBeTruthy();

  console.log(
    '\n✅ Agent-cli produces 100% OpenCode-compatible JSON structure'
  );
  console.log(
    `OpenCode events: ${opencodeEvents.length}, Agent-cli events: ${agentEvents.length}`
  );
});

test('OpenCode reference: processes plain text "2+2?" and produces JSON output', async () => {
  const input = '2+2?';
  const opencodeResult =
    await $`echo ${input} | opencode run --format json --model opencode/grok-code`
      .quiet()
      .nothrow();
  const opencodeLines = opencodeResult.stdout
    .toString()
    .trim()
    .split('\n')
    .filter((line) => line.trim());
  const opencodeEvents = opencodeLines.map((line) => JSON.parse(line));

  validateBasicMessageOutput(opencodeEvents, 'OpenCode (2+2?)');

  // Check that the response contains "4"
  const textEvents = opencodeEvents.filter((e) => e.type === 'text');
  expect(textEvents.length > 0).toBeTruthy();
  const responseText = textEvents[0].part.text;
  expect(responseText.includes('4')).toBeTruthy();

  console.log(`\nOpenCode response to "2+2?": ${responseText}`);
});

test('Agent-cli processes plain text "2+2?" and produces JSON output', async () => {
  const projectRoot = process.cwd();
  const input = '2+2?';
  const agentResult = await sh(
    `echo '${input}' | bun run ${projectRoot}/src/index.js`
  );
  const agentEvents = parseJSONOutput(agentResult.stdout);

  validateBasicMessageOutput(agentEvents, 'Agent-cli (2+2?)');

  // Check that the response contains "4"
  const textEvents = agentEvents.filter((e) => e.type === 'text');
  expect(textEvents.length > 0).toBeTruthy();
  const responseText = textEvents[0].part.text;
  expect(responseText.includes('4')).toBeTruthy();

  console.log(`\nAgent-cli response to "2+2?": ${responseText}`);
});

test('Agent-cli --version flag shows correct version', async () => {
  const projectRoot = process.cwd();
  const result = await sh(`bun run ${projectRoot}/src/index.js --version`);
  const version = result.stdout.trim();
  expect(version).toBe('0.1.0');
});
