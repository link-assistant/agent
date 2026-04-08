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

  // --- 1. Verify the agent produced output (non-empty stdout) ---
  expect(stdout.length).toBeGreaterThan(0);

  // --- 2. Verify HTTP request logs are present ---
  // The verbose wrapper logs "HTTP request" with method, URL, headers, body
  const hasHttpRequest =
    combined.includes('"message": "HTTP request"') ||
    combined.includes('"message":"HTTP request"');
  expect(hasHttpRequest).toBe(true);

  // --- 3. Verify HTTP response logs are present ---
  const hasHttpResponse =
    combined.includes('"message": "HTTP response"') ||
    combined.includes('"message":"HTTP response"');
  expect(hasHttpResponse).toBe(true);

  // --- 4. Verify verbose HTTP logging active diagnostic breadcrumb ---
  const hasVerboseActive =
    combined.includes('verbose HTTP logging active') ||
    combined.includes('[verbose] HTTP logging active');
  expect(hasVerboseActive).toBe(true);

  // --- 5. Verify request details are logged (URL, method) ---
  // Should contain an API endpoint URL (https://...)
  expect(combined.includes('https://')).toBe(true);

  // Should contain HTTP method (POST for LLM API calls)
  expect(
    combined.includes('"method": "POST"') ||
      combined.includes('"method":"POST"')
  ).toBe(true);

  // --- 6. Verify response status is logged ---
  expect(
    combined.includes('"status": 200') || combined.includes('"status":200')
  ).toBe(true);

  // --- 7. Verify response body or stream is logged ---
  const hasResponseBody =
    combined.includes('"message": "HTTP response body"') ||
    combined.includes('"message":"HTTP response body"') ||
    combined.includes('"message": "HTTP response body (stream)"') ||
    combined.includes('"message":"HTTP response body (stream)"');
  expect(hasResponseBody).toBe(true);

  // --- 8. Verify headers are logged (with sensitive values masked) ---
  expect(combined.includes('"headers"')).toBe(true);

  // Sensitive headers should NOT contain full API keys
  // (They should be masked like "sk-a...5678" or "[REDACTED]")
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

  // --- 9. Verify request body is logged (should contain bodyPreview) ---
  expect(combined.includes('"bodyPreview"')).toBe(true);

  // --- 10. Verify duration is logged ---
  expect(combined.includes('"durationMs"')).toBe(true);

  // --- 11. Verify the AI actually responded (output contains response text) ---
  // The agent should produce step_start/step_finish/text events
  expect(
    combined.includes('"type": "step_start"') ||
      combined.includes('"type":"step_start"') ||
      combined.includes('"type": "step-start"') ||
      combined.includes('"type":"step-start"')
  ).toBe(true);

  console.log('\n✅ Verbose HTTP logging verification passed');
  console.log('   - HTTP request logged: ✓');
  console.log('   - HTTP response logged: ✓');
  console.log('   - Verbose diagnostic breadcrumb: ✓');
  console.log('   - Request URL and method: ✓');
  console.log('   - Response status code: ✓');
  console.log('   - Response body/stream: ✓');
  console.log('   - Headers (sanitized): ✓');
  console.log('   - Body preview: ✓');
  console.log('   - Duration timing: ✓');
  console.log('   - Agent step events: ✓');
});
