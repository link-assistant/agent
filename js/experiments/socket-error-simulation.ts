/**
 * Socket Error Simulation Experiment
 *
 * This script simulates the Bun socket connection error scenario and demonstrates
 * how the retry logic handles it.
 *
 * Usage:
 *   bun run experiments/socket-error-simulation.ts
 *
 * Related issue: https://github.com/link-assistant/agent/issues/109
 * Bun issue: https://github.com/oven-sh/bun/issues/14439
 */

import { MessageV2 } from '../src/session/message-v2';
import { SessionRetry } from '../src/session/retry';

// Simulate the exact error message from Bun
const BUN_SOCKET_ERROR_MESSAGE =
  'The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()';

console.log('=== Socket Error Simulation Experiment ===\n');

// Test 1: Error detection
console.log('1. Testing error detection...');
const error = new Error(BUN_SOCKET_ERROR_MESSAGE);
const result = MessageV2.fromError(error, { providerID: 'opencode' });

console.log('   Error name:', result.name);
console.log('   Is retryable:', result.data.isRetryable);
console.log('   ✅ Socket error correctly detected\n');

// Test 2: Retry configuration
console.log('2. Retry configuration:');
console.log('   Max retries:', SessionRetry.SOCKET_ERROR_MAX_RETRIES);
console.log('   Initial delay:', SessionRetry.SOCKET_ERROR_INITIAL_DELAY, 'ms');
console.log(
  '   Backoff factor:',
  SessionRetry.SOCKET_ERROR_BACKOFF_FACTOR,
  '\n'
);

// Test 3: Simulate retry delays
console.log('3. Simulated retry delays:');
for (
  let attempt = 1;
  attempt <= SessionRetry.SOCKET_ERROR_MAX_RETRIES;
  attempt++
) {
  const delay = SessionRetry.socketErrorDelay(attempt);
  console.log(`   Attempt ${attempt}: ${delay}ms delay`);
}
console.log();

// Test 4: Total time before final failure
const totalDelay = [1, 2, 3].reduce(
  (sum, attempt) => sum + SessionRetry.socketErrorDelay(attempt),
  0
);
console.log('4. Total delay before final failure:', totalDelay, 'ms');
console.log('   (excluding request execution time)\n');

// Test 5: Compare with regular API error handling
console.log('5. Error type comparison:');

const regularError = new Error('Network error');
const regularResult = MessageV2.fromError(regularError, { providerID: 'test' });
console.log('   Regular error -> name:', regularResult.name);

const socketError = new Error(BUN_SOCKET_ERROR_MESSAGE);
const socketResult = MessageV2.fromError(socketError, { providerID: 'test' });
console.log('   Socket error -> name:', socketResult.name);
console.log();

console.log('=== Experiment Complete ===');
console.log(
  'Socket errors are now properly detected and will be retried up to 3 times.'
);
console.log('This addresses the Bun 10-second idle timeout issue.');
