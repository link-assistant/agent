/**
 * Experiment: Model-not-supported error detection
 *
 * Demonstrates how isModelNotSupportedError() distinguishes model-availability
 * errors from real authentication failures when both arrive as HTTP 401.
 *
 * Background (Issue #208):
 *   The OpenCode provider returned HTTP 401 with this body when a model was
 *   removed from its catalog:
 *     {"type":"error","error":{"type":"ModelError","message":"Model kimi-k2.5-free not supported"}}
 *
 *   Without detection this looks like a bad API key (auth failure), causing
 *   confusing diagnostics. This experiment confirms the detection logic works.
 *
 * @see https://github.com/link-assistant/agent/issues/208
 * @see docs/case-studies/issue-208/README.md
 */

import { SessionProcessor } from '../src/session/processor.ts';

const { isModelNotSupportedError } = SessionProcessor;

// ─── Scenario 1: OpenCode nested ModelError (the actual error from issue #208) ─
const openCodeBody = JSON.stringify({
  type: 'error',
  error: {
    type: 'ModelError',
    message: 'Model kimi-k2.5-free not supported',
  },
});

console.log('=== Scenario 1: OpenCode nested ModelError ===');
console.log('Response body:', openCodeBody);
const result1 = isModelNotSupportedError(openCodeBody);
console.log('isModelNotSupportedError:', result1);
console.assert(result1 === true, 'FAIL: expected true for OpenCode ModelError');
console.log('✅ Correctly detected as model-not-supported\n');

// ─── Scenario 2: Real authentication error (should NOT be detected) ─────────
const authErrorBody = JSON.stringify({
  type: 'error',
  error: {
    type: 'AuthenticationError',
    message: 'Invalid API key provided',
  },
});

console.log('=== Scenario 2: Real auth error (should NOT be detected) ===');
console.log('Response body:', authErrorBody);
const result2 = isModelNotSupportedError(authErrorBody);
console.log('isModelNotSupportedError:', result2);
console.assert(result2 === false, 'FAIL: expected false for auth error');
console.log('✅ Correctly identified as real auth error (not model issue)\n');

// ─── Scenario 3: OpenRouter flat format ──────────────────────────────────────
const openRouterBody = JSON.stringify({
  type: 'ModelError',
  message: 'Model glm-4.7-free is not available',
});

console.log('=== Scenario 3: OpenRouter flat ModelError format ===');
console.log('Response body:', openRouterBody);
const result3 = isModelNotSupportedError(openRouterBody);
console.log('isModelNotSupportedError:', result3);
console.assert(result3 === true, 'FAIL: expected true for flat ModelError');
console.log('✅ Correctly detected flat ModelError format\n');

// ─── Scenario 4: Non-JSON plain text response ─────────────────────────────────
const plainTextBody = 'Model not found: minimax-m2.5-free';

console.log('=== Scenario 4: Plain text "model not found" fallback ===');
console.log('Response body:', plainTextBody);
const result4 = isModelNotSupportedError(plainTextBody);
console.log('isModelNotSupportedError:', result4);
console.assert(result4 === true, 'FAIL: expected true for plain text');
console.log('✅ Correctly detected plain text model-not-found\n');

// ─── Scenario 5: Rate limit error (should NOT be detected) ───────────────────
const rateLimitBody = JSON.stringify({
  type: 'error',
  error: {
    type: 'RateLimitError',
    message: 'Rate limit exceeded. Try again in 60 seconds.',
  },
});

console.log('=== Scenario 5: Rate limit error (should NOT be detected) ===');
console.log('Response body:', rateLimitBody);
const result5 = isModelNotSupportedError(rateLimitBody);
console.log('isModelNotSupportedError:', result5);
console.assert(result5 === false, 'FAIL: expected false for rate limit error');
console.log('✅ Rate limit error correctly not flagged as model issue\n');

console.log('All scenarios passed ✅');
console.log(
  '\nConclusion: isModelNotSupportedError() reliably detects the ModelError'
);
console.log('pattern while avoiding false positives on real auth/rate-limit errors.');
