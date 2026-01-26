import { test, expect, describe, setDefaultTimeout } from 'bun:test';
// @ts-ignore
import { sh } from 'command-stream';

// Increase default timeout to 60 seconds for these tests
setDefaultTimeout(60000);

// Helper to parse NDJSON (newline-delimited JSON - Claude format)
function parseNDJSON(stdout) {
  const trimmed = stdout.trim();
  const lines = trimmed.split('\n').filter((line) => line.trim());
  return lines.map((line) => JSON.parse(line));
}

describe('Claude JSON Standard (experimental)', () => {
  const projectRoot = process.cwd();

  test('--json-standard claude produces NDJSON format', async () => {
    const input = '{"message":"hi"}';
    const result = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js --json-standard claude`
    );
    const stdout = result.stdout.trim();

    // NDJSON should have one JSON object per line
    const lines = stdout.split('\n').filter((line) => line.trim());
    expect(lines.length > 0).toBeTruthy();

    // Each line should be valid JSON
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }

    console.log(`✅ Claude format produces NDJSON (${lines.length} lines)`);
  });

  test('--json-standard claude produces compact JSON (not pretty-printed)', async () => {
    const input = '{"message":"hi"}';
    const result = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js --json-standard claude`
    );
    const stdout = result.stdout;

    // Each line should be a single JSON object (compact)
    const lines = stdout.split('\n').filter((line) => line.trim());
    for (const line of lines) {
      // Compact JSON should not have leading spaces for nested fields
      expect(line.startsWith('{')).toBeTruthy();
      expect(line.includes('  "')).toBeFalsy(); // No indentation
    }

    console.log('✅ Claude format produces compact JSON');
  });

  test('claude format uses claude event types', async () => {
    const input = '{"message":"hi"}';
    const result = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js --json-standard claude`
    );
    const events = parseNDJSON(result.stdout);

    // Valid Claude event types
    const validTypes = ['init', 'message', 'tool_use', 'tool_result', 'result'];

    for (const event of events) {
      expect(validTypes.includes(event.type)).toBeTruthy();
    }

    console.log(
      `✅ Claude format uses valid event types: ${[...new Set(events.map((e) => e.type))].join(', ')}`
    );
  });

  test('claude format has init event at start', async () => {
    const input = '{"message":"hi"}';
    const result = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js --json-standard claude`
    );
    const events = parseNDJSON(result.stdout);

    const initEvent = events.find((e) => e.type === 'init');
    expect(initEvent).toBeTruthy();
    expect(typeof initEvent.session_id).toBe('string');
    expect(typeof initEvent.timestamp).toBe('string'); // ISO string

    console.log(
      `✅ Claude format starts with init event (session_id: ${initEvent.session_id})`
    );
  });

  test('claude format has message event with content array', async () => {
    const input = '{"message":"hi"}';
    const result = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js --json-standard claude`
    );
    const events = parseNDJSON(result.stdout);

    const messageEvent = events.find((e) => e.type === 'message');
    expect(messageEvent).toBeTruthy();
    expect(messageEvent.role).toBe('assistant');
    expect(Array.isArray(messageEvent.content)).toBeTruthy();
    expect(messageEvent.content.length > 0).toBeTruthy();
    expect(messageEvent.content[0].type).toBe('text');
    expect(typeof messageEvent.content[0].text).toBe('string');

    console.log(`✅ Claude format has message with content array`);
  });

  test('claude format has result event at end', async () => {
    const input = '{"message":"hi"}';
    const result = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js --json-standard claude`
    );
    const events = parseNDJSON(result.stdout);

    const resultEvent = events.find((e) => e.type === 'result');
    expect(resultEvent).toBeTruthy();
    expect(resultEvent.status).toBe('success');
    expect(typeof resultEvent.session_id).toBe('string');
    expect(typeof resultEvent.timestamp).toBe('string');

    // duration_ms should be a number
    if (resultEvent.duration_ms !== undefined) {
      expect(typeof resultEvent.duration_ms).toBe('number');
      expect(resultEvent.duration_ms >= 0).toBeTruthy();
    }

    console.log(
      `✅ Claude format ends with result event (status: ${resultEvent.status})`
    );
  });

  test('claude format timestamp is ISO 8601 string', async () => {
    const input = '{"message":"hi"}';
    const result = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js --json-standard claude`
    );
    const events = parseNDJSON(result.stdout);

    for (const event of events) {
      if (event.timestamp) {
        // ISO 8601 format
        expect(typeof event.timestamp).toBe('string');
        expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
      }
    }

    console.log('✅ Claude format uses ISO 8601 timestamps');
  });

  test('claude format session_id uses snake_case', async () => {
    const input = '{"message":"hi"}';
    const result = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js --json-standard claude`
    );
    const events = parseNDJSON(result.stdout);

    // Claude format uses session_id (snake_case) not sessionID (camelCase)
    for (const event of events) {
      expect(event.sessionID).toBeUndefined(); // Should NOT have camelCase
      if (event.session_id) {
        expect(typeof event.session_id).toBe('string');
      }
    }

    console.log('✅ Claude format uses snake_case (session_id)');
  });

  test('claude format message response contains expected content', async () => {
    const input = '{"message":"2+2?"}';
    const result = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js --json-standard claude`
    );
    const events = parseNDJSON(result.stdout);

    const messageEvent = events.find((e) => e.type === 'message');
    expect(messageEvent).toBeTruthy();
    expect(messageEvent.content).toBeTruthy();
    expect(messageEvent.content[0].text.includes('4')).toBeTruthy();

    console.log(`✅ Claude format message contains expected response`);
  });

  test('claude format is different from opencode format', async () => {
    const input = '{"message":"hi"}';

    // Get opencode output
    const opencodeResult = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js --json-standard opencode`
    );
    const opencodeStdout = opencodeResult.stdout;

    // Get claude output
    const claudeResult = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js --json-standard claude`
    );
    const claudeStdout = claudeResult.stdout;

    // Opencode is pretty-printed, claude is compact
    expect(opencodeStdout.includes('  "')).toBeTruthy(); // Pretty-printed has indentation
    expect(claudeStdout.split('\n')[0].includes('  "')).toBeFalsy(); // Compact has no indentation

    // Event types are different
    expect(opencodeStdout.includes('"type": "step_start"')).toBeTruthy();
    expect(claudeStdout.includes('"type":"init"')).toBeTruthy();

    console.log('✅ Claude and OpenCode formats are clearly different');
  });

  test('claude format event sequence: init -> message(s) -> result', async () => {
    const input = '{"message":"hi"}';
    const result = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js --json-standard claude`
    );
    const events = parseNDJSON(result.stdout);

    // Find indices of key events
    const initIndex = events.findIndex((e) => e.type === 'init');
    const messageIndex = events.findIndex((e) => e.type === 'message');
    const resultIndex = events.findIndex((e) => e.type === 'result');

    // init should come first
    expect(initIndex).toBe(0);

    // message should be in the middle (after init)
    expect(messageIndex).toBeGreaterThan(initIndex);

    // result should be last
    expect(resultIndex).toBe(events.length - 1);

    console.log(
      `✅ Event sequence is correct: init(${initIndex}) -> message(${messageIndex}) -> result(${resultIndex})`
    );
  });
});
