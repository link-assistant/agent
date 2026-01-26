import { test, expect, setDefaultTimeout } from 'bun:test';
// @ts-ignore
import { sh } from 'command-stream';

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

test('Default system message: ask who are you', async () => {
  const projectRoot = process.cwd();
  const input = 'Who are you?';
  const agentResult = await sh(
    `echo '${input}' | bun run ${projectRoot}/src/index.js --format json`
  );
  const agentEvents = parseJSONOutput(agentResult.stdout);

  // Check for text event
  const textEvents = agentEvents.filter((e) => e.type === 'text');
  expect(textEvents.length > 0).toBeTruthy();
  const responseText = textEvents[0].part.text.toLowerCase();
  expect(responseText.includes('grok code fast 1')).toBeTruthy();

  console.log(`\nDefault response: ${responseText}`);
});

test('Full system message override from file: answer with "Answered from file."', async () => {
  const projectRoot = process.cwd();
  const input = 'Who are you?';
  const systemMessageFile = `${projectRoot}/data/tests/prompts/system-override.txt`;
  const agentResult = await sh(
    `echo '${input}' | bun run ${projectRoot}/src/index.js --format json --system-message-file "${systemMessageFile}"`
  );
  const agentEvents = parseJSONOutput(agentResult.stdout);

  // Check for text event
  const textEvents = agentEvents.filter((e) => e.type === 'text');
  expect(textEvents.length > 0).toBeTruthy();
  const responseText = textEvents[0].part.text;
  expect(responseText.toLowerCase().includes('grok code fast 1')).toBeFalsy();
  expect(responseText.trim().includes('Answered from file.')).toBeTruthy();

  console.log(`\nOverride from file response: ${responseText}`);
});

test('Append system message from file: default + append "Answered from file." at end', async () => {
  const projectRoot = process.cwd();
  const input = 'Who are you?';
  const appendMessageFile = `${projectRoot}/data/tests/prompts/append-message.txt`;
  const agentResult = await sh(
    `echo '${input}' | bun run ${projectRoot}/src/index.js --format json --append-system-message-file "${appendMessageFile}"`
  );
  const agentEvents = parseJSONOutput(agentResult.stdout);

  // Check for text event
  const textEvents = agentEvents.filter((e) => e.type === 'text');
  expect(textEvents.length > 0).toBeTruthy();
  const responseText = textEvents[0].part.text;
  expect(responseText.toLowerCase().includes('grok code fast 1')).toBeTruthy();
  expect(responseText.trim().endsWith('Answered from file.')).toBeTruthy();

  console.log(`\nAppend from file response: ${responseText}`);
});
