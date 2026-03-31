import { test, expect, setDefaultTimeout } from 'bun:test';
// @ts-ignore
import { sh } from 'command-stream';

// Increase default timeout to 120 seconds — real API calls may take longer
setDefaultTimeout(120000);

/**
 * Integration test: verifies that --verbose mode produces HTTP request/response logs.
 *
 * This is the hero test for issue #221. It sends the simplest possible message ("hi")
 * to a real API and verifies that HTTP traffic is fully logged in verbose mode.
 *
 * This test uses a real API with free-tier limits. It is the ONLY real-API test
 * intended for CI/CD execution. Other integration tests are manual (workflow_dispatch).
 *
 * @see https://github.com/link-assistant/agent/issues/221
 */

// Parse JSON output that may be pretty-printed (multi-line) or compact (one per line)
function parseJSONOutput(text) {
  const trimmed = text.trim();
  const lines = trimmed.split('\n').filter((line) => line.trim());

  // Try compact mode first (one JSON per line)
  try {
    JSON.parse(lines[0]);
    return lines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (_e) {
          return null;
        }
      })
      .filter(Boolean);
  } catch (_e) {
    // Fall through to pretty-printed mode
  }

  // Pretty-printed mode — extract individual JSON objects by brace counting
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

test('Agent-cli --verbose mode logs HTTP requests and responses for "hi"', async () => {
  const projectRoot = process.cwd();
  const input = '{"message":"hi"}';

  // Run with --verbose and --no-retry-on-rate-limits to get verbose HTTP logs
  const result = await sh(
    `echo '${input}' | bun run ${projectRoot}/src/index.js --verbose --no-retry-on-rate-limits`,
    { timeout: 110000 }
  );

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const combined = `${stdout}\n${stderr}`;

  console.log('\n=== Verbose test: stdout length:', stdout.length);
  console.log('=== Verbose test: stderr length:', stderr.length);

  // --- 1. Verify basic agent output works ---
  // Parse all JSON events from stdout (handles both compact and pretty-printed)
  const events = parseJSONOutput(stdout);

  // Debug: log event types found
  const typeCounts = {};
  for (const e of events) {
    const t = e.type || 'undefined';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }
  console.log('=== Parsed event types:', JSON.stringify(typeCounts));
  console.log('=== Total events parsed:', events.length);

  expect(events.length).toBeGreaterThan(0);

  // Should have agent output events — check for any of the known event types
  // In verbose mode the output includes both log events and agent events
  const agentEvents = events.filter(
    (e) =>
      e.type === 'text' ||
      e.type === 'step_start' ||
      e.type === 'step_finish' ||
      e.type === 'step-start' ||
      e.type === 'step-finish' ||
      e.type === 'message.part.updated' ||
      e.type === 'session.updated' ||
      e.type === 'session.idle'
  );
  console.log('=== Agent events found:', agentEvents.length);
  expect(agentEvents.length).toBeGreaterThan(0);

  // --- 2. Verify HTTP request logs are present ---
  // The verbose wrapper logs "HTTP request" with method, URL, headers, body
  const hasHttpRequest =
    combined.includes('HTTP request') || combined.includes('"HTTP request"');
  expect(hasHttpRequest).toBe(true);

  // --- 3. Verify HTTP response logs are present ---
  const hasHttpResponse =
    combined.includes('HTTP response') || combined.includes('"HTTP response"');
  expect(hasHttpResponse).toBe(true);

  // --- 4. Verify verbose HTTP logging active diagnostic breadcrumb ---
  const hasVerboseActive =
    combined.includes('verbose HTTP logging active') ||
    combined.includes('[verbose] HTTP logging active');
  expect(hasVerboseActive).toBe(true);

  // --- 5. Verify request details are logged (URL, method) ---
  const hasUrl = combined.includes('https://');
  expect(hasUrl).toBe(true);

  const hasMethod = combined.includes('POST') || combined.includes('"POST"');
  expect(hasMethod).toBe(true);

  // --- 6. Verify response status is logged ---
  const hasStatus =
    combined.includes('"status":200') ||
    combined.includes('"status": 200') ||
    combined.includes('status: 200');
  expect(hasStatus).toBe(true);

  // --- 7. Verify response body or stream is logged ---
  const hasResponseBody =
    combined.includes('HTTP response body') || combined.includes('bodyPreview');
  expect(hasResponseBody).toBe(true);

  // --- 8. Verify headers are logged (with sensitive values masked) ---
  const hasHeaders =
    combined.includes('headers') || combined.includes('Headers');
  expect(hasHeaders).toBe(true);

  // Sensitive headers should NOT contain full API keys
  const apiKeyPatterns = [
    /["']?(?:x-api-key|authorization|api-key)["']?\s*:\s*["'][a-zA-Z0-9_-]{20,}["']/i,
  ];
  for (const pattern of apiKeyPatterns) {
    const match = combined.match(pattern);
    if (match) {
      const value = match[0];
      const isMasked = value.includes('...') || value.includes('[REDACTED]');
      expect(isMasked).toBe(true);
    }
  }

  // --- 9. Verify request body is logged ---
  const hasRequestBody =
    combined.includes('bodyPreview') || combined.includes('body');
  expect(hasRequestBody).toBe(true);

  // --- 10. Verify duration is logged ---
  const hasDuration =
    combined.includes('durationMs') || combined.includes('duration');
  expect(hasDuration).toBe(true);

  console.log('\n✅ Verbose HTTP logging verification passed');
  console.log('   - HTTP request logged: ✓');
  console.log('   - HTTP response logged: ✓');
  console.log('   - Verbose diagnostic breadcrumb: ✓');
  console.log('   - Request URL and method: ✓');
  console.log('   - Response status code: ✓');
  console.log('   - Response body/stream: ✓');
  console.log('   - Headers (sanitized): ✓');
  console.log('   - Duration timing: ✓');
});
