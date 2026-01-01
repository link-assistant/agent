import { test, expect, describe, setDefaultTimeout } from 'bun:test';
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

describe('OpenCode JSON Standard', () => {
  const projectRoot = process.cwd();

  test('default output format is opencode (pretty-printed JSON)', async () => {
    const input = '{"message":"hi"}';
    const result = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js`
    );
    const events = parseJSONOutput(result.stdout);

    // Should have events
    expect(events.length > 0).toBeTruthy();

    // First event should be step_start
    const startEvent = events.find((e) => e.type === 'step_start');
    expect(startEvent).toBeTruthy();
    expect(typeof startEvent.timestamp).toBe('number');
    expect(typeof startEvent.sessionID).toBe('string');
    expect(startEvent.sessionID.startsWith('ses_')).toBeTruthy();

    console.log('✅ Default format is opencode with pretty-printed JSON');
  });

  test('explicit --json-standard opencode produces same format as default', async () => {
    const input = '{"message":"hi"}';

    // Get default output
    const defaultResult = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js`
    );
    const defaultEvents = parseJSONOutput(defaultResult.stdout);

    // Get explicit opencode output
    const opencodeResult = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js --json-standard opencode`
    );
    const opencodeEvents = parseJSONOutput(opencodeResult.stdout);

    // Both should have same event types
    const defaultTypes = new Set(defaultEvents.map((e) => e.type));
    const opencodeTypes = new Set(opencodeEvents.map((e) => e.type));

    expect(defaultTypes).toEqual(opencodeTypes);
    console.log(`✅ Explicit --json-standard opencode matches default output`);
    console.log(`Event types: ${[...opencodeTypes].join(', ')}`);
  });

  test('opencode format includes required fields', async () => {
    const input = '{"message":"hi"}';
    const result = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js --json-standard opencode`
    );
    const events = parseJSONOutput(result.stdout);

    for (const event of events) {
      // Every event must have these fields
      expect(typeof event.type).toBe('string');
      expect(typeof event.timestamp).toBe('number');
      expect(typeof event.sessionID).toBe('string');
      expect(event.sessionID.startsWith('ses_')).toBeTruthy();

      // part should exist for most events (except error which has error field)
      if (event.type !== 'error') {
        expect(event.part).toBeTruthy();
        expect(typeof event.part.id).toBe('string');
      }
    }

    console.log(`✅ All ${events.length} events have required opencode fields`);
  });

  test('opencode format event types', async () => {
    const input = '{"message":"hi"}';
    const result = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js --json-standard opencode`
    );
    const events = parseJSONOutput(result.stdout);

    // Valid opencode event types
    const validTypes = [
      'step_start',
      'step_finish',
      'text',
      'tool_use',
      'error',
    ];

    for (const event of events) {
      expect(validTypes.includes(event.type)).toBeTruthy();
    }

    // Must have step_start
    expect(events.some((e) => e.type === 'step_start')).toBeTruthy();

    // Must have step_finish
    expect(events.some((e) => e.type === 'step_finish')).toBeTruthy();

    // Must have text (the AI response)
    expect(events.some((e) => e.type === 'text')).toBeTruthy();

    console.log('✅ OpenCode format has correct event types');
  });

  test('opencode format text event has text content', async () => {
    const input = '{"message":"2+2?"}';
    const result = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js --json-standard opencode`
    );
    const events = parseJSONOutput(result.stdout);

    const textEvents = events.filter((e) => e.type === 'text');
    expect(textEvents.length > 0).toBeTruthy();

    const textEvent = textEvents[0];
    expect(textEvent.part).toBeTruthy();
    expect(typeof textEvent.part.text).toBe('string');
    expect(textEvent.part.text.length > 0).toBeTruthy();
    expect(textEvent.part.text.includes('4')).toBeTruthy(); // Response should include "4"

    console.log(
      `✅ Text event contains response: "${textEvent.part.text.substring(0, 50)}..."`
    );
  });

  test('opencode format step_start has part with id', async () => {
    const input = '{"message":"hi"}';
    const result = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js --json-standard opencode`
    );
    const events = parseJSONOutput(result.stdout);

    const startEvent = events.find((e) => e.type === 'step_start');
    expect(startEvent).toBeTruthy();
    expect(startEvent.part).toBeTruthy();
    expect(typeof startEvent.part.id).toBe('string');
    expect(startEvent.part.id.startsWith('prt_')).toBeTruthy();

    console.log(`✅ step_start has valid part.id: ${startEvent.part.id}`);
  });

  test('opencode format step_finish has part with id', async () => {
    const input = '{"message":"hi"}';
    const result = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js --json-standard opencode`
    );
    const events = parseJSONOutput(result.stdout);

    const finishEvent = events.find((e) => e.type === 'step_finish');
    expect(finishEvent).toBeTruthy();
    expect(finishEvent.part).toBeTruthy();
    expect(typeof finishEvent.part.id).toBe('string');
    expect(finishEvent.part.id.startsWith('prt_')).toBeTruthy();

    console.log(`✅ step_finish has valid part.id: ${finishEvent.part.id}`);
  });

  test('opencode format timestamp is valid Unix milliseconds', async () => {
    const input = '{"message":"hi"}';
    const beforeTime = Date.now();
    const result = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js --json-standard opencode`
    );
    const afterTime = Date.now();
    const events = parseJSONOutput(result.stdout);

    for (const event of events) {
      expect(event.timestamp >= beforeTime).toBeTruthy();
      expect(event.timestamp <= afterTime).toBeTruthy();
    }

    console.log(
      `✅ All timestamps are valid (between ${beforeTime} and ${afterTime})`
    );
  });

  test('opencode format is pretty-printed (multi-line JSON)', async () => {
    const input = '{"message":"hi"}';
    const result = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js --json-standard opencode`
    );
    const stdout = result.stdout;

    // Pretty-printed JSON should have indentation (2 spaces)
    expect(stdout.includes('  "type"')).toBeTruthy();

    // Events should span multiple lines
    const lines = stdout.split('\n');
    expect(lines.length > 5).toBeTruthy();

    console.log(`✅ Output is pretty-printed (${lines.length} lines)`);
  });
});
