/**
 * Tests for --output-response-model flag
 * @see https://github.com/link-assistant/agent/issues/179
 */

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

test('--output-response-model flag includes model info in step_finish events', async () => {
  const projectRoot = process.cwd();
  const input = '{"message":"hi"}';

  // Run with --output-response-model flag
  const result = await sh(
    `echo '${input}' | bun run ${projectRoot}/src/index.js --output-response-model`
  );
  const events = parseJSONOutput(result.stdout);

  // Find step_finish events
  const stepFinishEvents = events.filter((e) => e.type === 'step_finish');
  expect(stepFinishEvents.length > 0).toBeTruthy();

  // Check that step_finish includes model info with new field names
  const stepFinish = stepFinishEvents[0];
  expect(stepFinish.part.model).toBeTruthy();
  expect(typeof stepFinish.part.model.providerID).toBe('string');
  expect(typeof stepFinish.part.model.requestedModelID).toBe('string');

  console.log(
    '\n✅ --output-response-model includes model info in step_finish:'
  );
  console.log(JSON.stringify(stepFinish.part.model, null, 2));
});

test('Without --output-response-model flag, model info is NOT included', async () => {
  const projectRoot = process.cwd();
  const input = '{"message":"hi"}';

  // Run without --output-response-model flag
  const result = await sh(
    `echo '${input}' | bun run ${projectRoot}/src/index.js`
  );
  const events = parseJSONOutput(result.stdout);

  // Find step_finish events
  const stepFinishEvents = events.filter((e) => e.type === 'step_finish');
  expect(stepFinishEvents.length > 0).toBeTruthy();

  // Check that step_finish does NOT include model info (unless explicitly enabled)
  const stepFinish = stepFinishEvents[0];
  // Model info should be undefined when flag is not set
  expect(stepFinish.part.model).toBeUndefined();

  console.log('\n✅ Without flag, model info is not included');
});

test('AGENT_OUTPUT_RESPONSE_MODEL env var enables model info output', async () => {
  const projectRoot = process.cwd();
  const input = '{"message":"hi"}';

  // Run with environment variable
  const result = await sh(
    `echo '${input}' | AGENT_OUTPUT_RESPONSE_MODEL=true bun run ${projectRoot}/src/index.js`
  );
  const events = parseJSONOutput(result.stdout);

  // Find step_finish events
  const stepFinishEvents = events.filter((e) => e.type === 'step_finish');
  expect(stepFinishEvents.length > 0).toBeTruthy();

  // Check that step_finish includes model info with new field names
  const stepFinish = stepFinishEvents[0];
  expect(stepFinish.part.model).toBeTruthy();
  expect(typeof stepFinish.part.model.providerID).toBe('string');
  expect(typeof stepFinish.part.model.requestedModelID).toBe('string');

  console.log('\n✅ AGENT_OUTPUT_RESPONSE_MODEL=true enables model info');
});

test('--summarize-session flag controls session summarization', async () => {
  const projectRoot = process.cwd();
  const input = '{"message":"hi"}';

  // Run without --summarize-session flag (default: disabled)
  const result = await sh(
    `echo '${input}' | bun run ${projectRoot}/src/index.js 2>&1`
  );

  // Check that session summarization is disabled by default
  expect(result.stdout + result.stderr).toContain(
    'session summarization disabled'
  );

  console.log('\n✅ Session summarization is disabled by default');
});
