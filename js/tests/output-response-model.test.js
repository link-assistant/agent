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

test('Model info is included by default in step_finish events', async () => {
  const projectRoot = process.cwd();
  const input = '{"message":"hi"}';

  // Run without any flags (default behavior includes model info)
  const result = await sh(
    `echo '${input}' | bun run ${projectRoot}/src/index.js`
  );
  const events = parseJSONOutput(result.stdout);

  // Find step_finish events
  const stepFinishEvents = events.filter((e) => e.type === 'step_finish');
  expect(stepFinishEvents.length > 0).toBeTruthy();

  // Check that step_finish includes model info with new field names (enabled by default)
  const stepFinish = stepFinishEvents[0];
  expect(stepFinish.part.model).toBeTruthy();
  expect(typeof stepFinish.part.model.providerID).toBe('string');
  expect(typeof stepFinish.part.model.requestedModelID).toBe('string');

  console.log('\n✅ Model info included by default in step_finish:');
  console.log(JSON.stringify(stepFinish.part.model, null, 2));
});

test('--no-output-response-model flag disables model info in step_finish events', async () => {
  const projectRoot = process.cwd();
  const input = '{"message":"hi"}';

  // Run with --no-output-response-model flag to disable it
  const result = await sh(
    `echo '${input}' | bun run ${projectRoot}/src/index.js --no-output-response-model`
  );
  const events = parseJSONOutput(result.stdout);

  // Find step_finish events
  const stepFinishEvents = events.filter((e) => e.type === 'step_finish');
  expect(stepFinishEvents.length > 0).toBeTruthy();

  // Check that step_finish does NOT include model info when explicitly disabled
  const stepFinish = stepFinishEvents[0];
  // Model info should be undefined when explicitly disabled
  expect(stepFinish.part.model).toBeUndefined();

  console.log('\n✅ --no-output-response-model disables model info');
});

test('AGENT_OUTPUT_RESPONSE_MODEL=false env var disables model info output', async () => {
  const projectRoot = process.cwd();
  const input = '{"message":"hi"}';

  // Run with environment variable set to false
  const result = await sh(
    `echo '${input}' | AGENT_OUTPUT_RESPONSE_MODEL=false bun run ${projectRoot}/src/index.js`
  );
  const events = parseJSONOutput(result.stdout);

  // Find step_finish events
  const stepFinishEvents = events.filter((e) => e.type === 'step_finish');
  expect(stepFinishEvents.length > 0).toBeTruthy();

  // Check that step_finish does NOT include model info when env var is false
  const stepFinish = stepFinishEvents[0];
  expect(stepFinish.part.model).toBeUndefined();

  console.log('\n✅ AGENT_OUTPUT_RESPONSE_MODEL=false disables model info');
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
