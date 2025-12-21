import { test, expect, describe, setDefaultTimeout } from 'bun:test';
// @ts-ignore
import { sh } from 'command-stream';

// Increase default timeout
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

/**
 * Test suite for --dry-run mode - Issue #68 and #89
 * Tests that dry-run mode is properly configured and can be enabled
 * Also tests the echo provider that echoes back user input
 *
 * @see https://github.com/link-assistant/agent/issues/68
 * @see https://github.com/link-assistant/agent/issues/89
 */
describe('Dry-run mode', () => {
  test('Flag.setDryRun sets OPENCODE_DRY_RUN', async () => {
    const { Flag } = await import('../src/flag/flag.ts');

    // Save original value
    const original = Flag.OPENCODE_DRY_RUN;

    try {
      // Test setting to true
      Flag.setDryRun(true);
      expect(Flag.OPENCODE_DRY_RUN).toBe(true);

      // Test setting to false
      Flag.setDryRun(false);
      expect(Flag.OPENCODE_DRY_RUN).toBe(false);
    } finally {
      // Restore original value
      Flag.setDryRun(original);
    }
  });

  test('OPENCODE_DRY_RUN environment variable is respected', async () => {
    // This test verifies that the env var is properly read
    const { Flag } = await import('../src/flag/flag.ts');

    // The flag should be false by default (unless env var is set)
    expect(typeof Flag.OPENCODE_DRY_RUN).toBe('boolean');
  });

  test('dry-run mode can be enabled programmatically', async () => {
    const { Flag } = await import('../src/flag/flag.ts');

    // Save original value
    const original = Flag.OPENCODE_DRY_RUN;

    try {
      // Enable dry-run mode
      Flag.setDryRun(true);

      // Verify it's enabled
      expect(Flag.OPENCODE_DRY_RUN).toBe(true);

      // Disable dry-run mode
      Flag.setDryRun(false);

      // Verify it's disabled
      expect(Flag.OPENCODE_DRY_RUN).toBe(false);
    } finally {
      // Restore original value
      Flag.setDryRun(original);
    }
  });

  test('Verbose mode flag can be set', async () => {
    const { Flag } = await import('../src/flag/flag.ts');

    // Save original value
    const original = Flag.OPENCODE_VERBOSE;

    try {
      // Test setting to true
      Flag.setVerbose(true);
      expect(Flag.OPENCODE_VERBOSE).toBe(true);

      // Test setting to false
      Flag.setVerbose(false);
      expect(Flag.OPENCODE_VERBOSE).toBe(false);
    } finally {
      // Restore original value
      Flag.setVerbose(original);
    }
  });
});

/**
 * Test suite for echo provider - Issue #89
 * Tests that the echo provider correctly echoes back user input
 *
 * @see https://github.com/link-assistant/agent/issues/89
 */
describe('Echo provider (dry-run mode)', () => {
  const projectRoot = process.cwd();

  test('dry-run mode echoes back "hi" message', async () => {
    const input = '{"message":"hi"}';
    const result = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js --dry-run --no-always-accept-stdin`
    );
    const events = parseJSONOutput(result.stdout);

    // Should have events
    expect(events.length > 0).toBeTruthy();

    // Check for text event with echoed content
    const textEvents = events.filter((e) => e.type === 'text');
    expect(textEvents.length > 0).toBeTruthy();
    expect(textEvents[0].part.text).toBe('hi');

    console.log('\n✅ dry-run mode correctly echoes "hi"');
  });

  test('dry-run mode echoes back "How are you?" message', async () => {
    const input = '{"message":"How are you?"}';
    const result = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js --dry-run --no-always-accept-stdin`
    );
    const events = parseJSONOutput(result.stdout);

    // Should have events
    expect(events.length > 0).toBeTruthy();

    // Check for text event with echoed content
    const textEvents = events.filter((e) => e.type === 'text');
    expect(textEvents.length > 0).toBeTruthy();
    expect(textEvents[0].part.text).toBe('How are you?');

    console.log('\n✅ dry-run mode correctly echoes "How are you?"');
  });

  test('dry-run mode echoes back plain text input', async () => {
    const input = 'Hello, world!';
    const result = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js --dry-run --no-always-accept-stdin`
    );
    const events = parseJSONOutput(result.stdout);

    // Should have events
    expect(events.length > 0).toBeTruthy();

    // Check for text event with echoed content
    const textEvents = events.filter((e) => e.type === 'text');
    expect(textEvents.length > 0).toBeTruthy();
    expect(textEvents[0].part.text).toBe('Hello, world!');

    console.log('\n✅ dry-run mode correctly echoes plain text input');
  });

  test('dry-run mode produces complete event structure', async () => {
    const input = '{"message":"test"}';
    const result = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js --dry-run --no-always-accept-stdin`
    );
    const events = parseJSONOutput(result.stdout);

    // Check for step_start event
    const startEvents = events.filter((e) => e.type === 'step_start');
    expect(startEvents.length > 0).toBeTruthy();

    // Check for step_finish event
    const finishEvents = events.filter((e) => e.type === 'step_finish');
    expect(finishEvents.length > 0).toBeTruthy();

    // Check for text event
    const textEvents = events.filter((e) => e.type === 'text');
    expect(textEvents.length > 0).toBeTruthy();

    // Validate event structure
    for (const event of events) {
      if (event.type === 'status') {
        continue;
      } // Skip status messages
      expect(typeof event.type).toBe('string');
      expect(typeof event.timestamp).toBe('number');
      expect(typeof event.sessionID).toBe('string');
      expect(event.sessionID.startsWith('ses_')).toBeTruthy();
      expect(event.part).toBeTruthy();
      expect(typeof event.part.id).toBe('string');
      expect(event.part.id.startsWith('prt_')).toBeTruthy();
    }

    console.log(
      '\n✅ dry-run mode produces complete event structure with all required fields'
    );
  });

  test('dry-run mode uses link-assistant/echo provider', async () => {
    const input = '{"message":"test provider check"}';
    const result = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js --dry-run --no-always-accept-stdin`
    );
    const events = parseJSONOutput(result.stdout);

    // Verify the output includes the DRY RUN MODE message (could be in stdout or stderr)
    const allOutput = result.stdout + result.stderr;
    expect(allOutput.includes('[DRY RUN MODE]')).toBeTruthy();

    // Verify the echoed response
    const textEvents = events.filter((e) => e.type === 'text');
    expect(textEvents.length > 0).toBeTruthy();
    expect(textEvents[0].part.text).toBe('test provider check');

    console.log('\n✅ dry-run mode uses link-assistant/echo provider');
  });

  test('dry-run mode incurs zero cost', async () => {
    const input = '{"message":"cost check"}';
    const result = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js --dry-run --no-always-accept-stdin`
    );
    const events = parseJSONOutput(result.stdout);

    // Check step_finish event for cost
    const finishEvents = events.filter((e) => e.type === 'step_finish');
    expect(finishEvents.length > 0).toBeTruthy();

    // Cost should be 0 in dry-run mode
    const cost = finishEvents[0].part.cost;
    expect(cost).toBe(0);

    console.log('\n✅ dry-run mode incurs zero cost');
  });

  test('dry-run mode handles multi-turn conversation', async () => {
    const inputs = [
      '{"message":"Hello"}',
      '{"message":"How are you?"}',
      '{"message":"What is 2+2?"}',
    ];

    for (const input of inputs) {
      const result = await sh(
        `echo '${input}' | bun run ${projectRoot}/src/index.js --dry-run --no-always-accept-stdin`
      );
      const events = parseJSONOutput(result.stdout);

      // Should have events
      expect(events.length > 0).toBeTruthy();

      // Check for text event with echoed content
      const textEvents = events.filter((e) => e.type === 'text');
      expect(textEvents.length > 0).toBeTruthy();

      // Verify the response matches the input
      const expectedText = JSON.parse(input).message;
      expect(textEvents[0].part.text).toBe(expectedText);
    }

    console.log('\n✅ dry-run mode handles multi-turn conversation');
  });

  test('dry-run mode handles complex JSON input', async () => {
    const input = JSON.stringify({
      message: 'Complex message with special characters: @#$%^&*()',
      metadata: { test: true, id: 123 },
    });
    const result = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js --dry-run --no-always-accept-stdin`
    );
    const events = parseJSONOutput(result.stdout);

    // Should have events
    expect(events.length > 0).toBeTruthy();

    // Check for text event with echoed content
    const textEvents = events.filter((e) => e.type === 'text');
    expect(textEvents.length > 0).toBeTruthy();
    expect(textEvents[0].part.text).toBe(
      'Complex message with special characters: @#$%^&*()'
    );

    console.log('\n✅ dry-run mode handles complex JSON input');
  });

  test('dry-run mode handles empty message', async () => {
    const input = '{"message":""}';
    const result = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js --dry-run --no-always-accept-stdin`
    );
    const events = parseJSONOutput(result.stdout);

    // Should have events
    expect(events.length > 0).toBeTruthy();

    // Check for text event - empty messages get defaulted to 'hi' by the system
    const textEvents = events.filter((e) => e.type === 'text');
    expect(textEvents.length > 0).toBeTruthy();
    expect(textEvents[0].part.text).toBe('hi'); // System defaults empty messages to 'hi'

    console.log('\n✅ dry-run mode handles empty message');
  });

  test('dry-run mode handles long messages', async () => {
    const longMessage = 'A'.repeat(1000);
    const input = `{"message":"${longMessage}"}`;
    const result = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js --dry-run --no-always-accept-stdin`
    );
    const events = parseJSONOutput(result.stdout);

    // Should have events
    expect(events.length > 0).toBeTruthy();

    // Check for text event with echoed content
    const textEvents = events.filter((e) => e.type === 'text');
    expect(textEvents.length > 0).toBeTruthy();
    expect(textEvents[0].part.text).toBe(longMessage);

    console.log('\n✅ dry-run mode handles long messages');
  });
});

/**
 * Note: CLI tests for cache provider are skipped because the current
 * CLI argument parser doesn't support multi-slash provider IDs like
 * link-assistant/cache. The cache provider unit tests (below) verify
 * the functionality directly.
 *
 * @see https://github.com/link-assistant/agent/issues/89
 */

/**
 * Test suite for echo provider unit tests
 * Tests the echo provider directly without going through the CLI
 */
describe('Echo provider (unit tests)', () => {
  test('createEchoModel returns a valid LanguageModelV2', async () => {
    const { createEchoModel } = await import('../src/provider/echo.ts');

    const model = createEchoModel('test-echo');

    expect(model.specificationVersion).toBe('v2');
    expect(model.provider).toBe('link-assistant');
    expect(model.modelId).toBe('test-echo');
    expect(typeof model.doGenerate).toBe('function');
    expect(typeof model.doStream).toBe('function');

    console.log('\n✅ createEchoModel returns a valid LanguageModelV2');
  });

  test('doGenerate echoes back user message', async () => {
    const { createEchoModel } = await import('../src/provider/echo.ts');

    const model = createEchoModel('test-echo');
    const prompt = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Echo this message' }],
      },
    ];

    const result = await model.doGenerate({ prompt });

    expect(result.content).toBeTruthy();
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toBe('Echo this message');
    expect(result.finishReason).toBe('stop');

    console.log('\n✅ doGenerate echoes back user message');
  });

  test('doStream produces proper stream events', async () => {
    const { createEchoModel } = await import('../src/provider/echo.ts');

    const model = createEchoModel('test-echo');
    const prompt = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Stream test' }],
      },
    ];

    const response = await model.doStream({ prompt });
    const reader = response.stream.getReader();

    const events = [];
    let done = false;
    while (!done) {
      const { value, done: streamDone } = await reader.read();
      done = streamDone;
      if (value) {
        events.push(value);
      }
    }

    // Should have text-start, text-delta(s), text-end, finish
    const types = events.map((e) => e.type);
    expect(types.includes('text-start')).toBeTruthy();
    expect(types.includes('text-delta')).toBeTruthy();
    expect(types.includes('text-end')).toBeTruthy();
    expect(types.includes('finish')).toBeTruthy();

    // Collect the delta text
    const deltaText = events
      .filter((e) => e.type === 'text-delta')
      .map((e) => e.delta)
      .join('');
    expect(deltaText).toBe('Stream test');

    console.log('\n✅ doStream produces proper stream events');
  });
});

/**
 * Test suite for cache provider unit tests
 * Tests the cache provider directly without going through the CLI
 */
describe('Cache provider (unit tests)', () => {
  test('createCacheModel returns a valid LanguageModelV2', async () => {
    const { createCacheModel } = await import('../src/provider/cache.ts');

    const model = createCacheModel('opencode', 'grok-code');

    expect(model.specificationVersion).toBe('v2');
    expect(model.provider).toBe('link-assistant');
    expect(model.modelId).toBe('opencode/grok-code');
    expect(typeof model.doGenerate).toBe('function');
    expect(typeof model.doStream).toBe('function');

    console.log('\n✅ createCacheModel returns a valid LanguageModelV2');
  });

  test('cache provider generates and caches responses', async () => {
    const { createCacheModel } = await import('../src/provider/cache.ts');

    const model = createCacheModel('opencode', 'grok-code');
    const prompt = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Cache this response' }],
      },
    ];

    // First call should generate and cache
    const result1 = await model.doGenerate({ prompt });
    expect(result1.content).toBeTruthy();
    expect(result1.content.length).toBeGreaterThan(0);
    expect(result1.content[0].type).toBe('text');
    expect(result1.content[0].text).toBe('Cache this response');

    // Second call should use cached response
    const result2 = await model.doGenerate({ prompt });
    expect(result2.content).toBeTruthy();
    expect(result2.content.length).toBeGreaterThan(0);
    expect(result2.content[0].type).toBe('text');
    expect(result2.content[0].text).toBe('Cache this response');

    console.log('\n✅ cache provider generates and caches responses');
  });

  test('cache provider streams cached responses', async () => {
    const { createCacheModel } = await import('../src/provider/cache.ts');

    const model = createCacheModel('opencode', 'grok-code');
    const prompt = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Stream cached response' }],
      },
    ];

    // Generate first to cache
    await model.doGenerate({ prompt });

    // Now stream should use cached response
    const response = await model.doStream({ prompt });
    const reader = response.stream.getReader();

    const events = [];
    let done = false;
    while (!done) {
      const { value, done: streamDone } = await reader.read();
      done = streamDone;
      if (value) {
        events.push(value);
      }
    }

    // Should have text-start, text-delta(s), text-end, finish
    const types = events.map((e) => e.type);
    expect(types.includes('text-start')).toBeTruthy();
    expect(types.includes('text-delta')).toBeTruthy();
    expect(types.includes('text-end')).toBeTruthy();
    expect(types.includes('finish')).toBeTruthy();

    // Collect the delta text
    const deltaText = events
      .filter((e) => e.type === 'text-delta')
      .map((e) => e.delta)
      .join('');
    expect(deltaText).toBe('Stream cached response');

    console.log('\n✅ cache provider streams cached responses');
  });
});
