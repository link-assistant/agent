#!/usr/bin/env node

/**
 * Test script to verify the failure detection logic works correctly
 *
 * This script simulates the output that changeset publish produces
 * when packages fail to publish, and verifies that our detection
 * logic correctly identifies the failure.
 */

// Copy of the failure patterns from publish-to-npm.mjs
const FAILURE_PATTERNS = [
  'packages failed to publish',
  'error occurred while publishing',
  'npm error code E',
  'npm error 404',
  'npm error 401',
  'npm error 403',
  'Access token expired',
  'ENEEDAUTH',
];

/**
 * Check if the output contains any failure patterns
 * @param {string} output - Combined stdout and stderr
 * @returns {string|null} - The matched failure pattern or null if no failure detected
 */
function detectPublishFailure(output) {
  const lowerOutput = output.toLowerCase();
  for (const pattern of FAILURE_PATTERNS) {
    if (lowerOutput.includes(pattern.toLowerCase())) {
      return pattern;
    }
  }
  return null;
}

// Test cases based on real CI failure output from issue #115
const testCases = [
  {
    name: 'Real changeset failure output from issue #115',
    output: `🦋  info npm info @link-assistant/agent
🦋  info @link-assistant/agent is being published because our local version (0.8.0) has not been published on npm
🦋  info Publishing "@link-assistant/agent" at "0.8.0"
🦋  error an error occurred while publishing @link-assistant/agent: E404 Not Found - PUT https://registry.npmjs.org/@link-assistant%2fagent - Not found
🦋  error The requested resource '@link-assistant/agent@0.8.0' could not be found or you do not have permission to access it.
🦋  error npm error code E404
🦋  error npm error 404 Not Found - PUT https://registry.npmjs.org/@link-assistant%2fagent - Not found
🦋  error packages failed to publish:
🦋  @link-assistant/agent@0.8.0`,
    shouldFail: true,
  },
  {
    name: 'Access token expired error',
    output: `🦋  error npm notice Access token expired or revoked. Please try logging in again.`,
    shouldFail: true,
  },
  {
    name: '401 Unauthorized error',
    output: `npm error 401 Unauthorized - PUT https://registry.npmjs.org/@link-assistant%2fagent`,
    shouldFail: true,
  },
  {
    name: '403 Forbidden error',
    output: `npm error 403 Forbidden - PUT https://registry.npmjs.org/@link-assistant%2fagent`,
    shouldFail: true,
  },
  {
    name: 'ENEEDAUTH error',
    output: `npm error code ENEEDAUTH`,
    shouldFail: true,
  },
  {
    name: 'Successful publish output',
    output: `🦋  info npm info @link-assistant/agent
🦋  info @link-assistant/agent is being published because our local version (0.8.0) has not been published on npm
🦋  info Publishing "@link-assistant/agent" at "0.8.0"
🦋  success packages published successfully:
🦋  @link-assistant/agent@0.8.0`,
    shouldFail: false,
  },
  {
    name: 'No output (empty)',
    output: '',
    shouldFail: false,
  },
];

console.log('Testing failure detection logic...\n');

let passed = 0;
let failed = 0;

for (const tc of testCases) {
  const result = detectPublishFailure(tc.output);
  const detected = result !== null;
  const isCorrect = detected === tc.shouldFail;

  if (isCorrect) {
    console.log(`✅ PASS: ${tc.name}`);
    if (detected) {
      console.log(`   Detected pattern: "${result}"`);
    }
    passed++;
  } else {
    console.log(`❌ FAIL: ${tc.name}`);
    console.log(`   Expected failure: ${tc.shouldFail}, but got: ${detected}`);
    if (detected) {
      console.log(`   Detected pattern: "${result}"`);
    }
    failed++;
  }
  console.log();
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
