/**
 * Experiment: Test whether verbose HTTP logging actually works
 * Related to: https://github.com/link-assistant/agent/issues/215
 *
 * This experiment directly tests the verbose HTTP logging wrapper
 * to verify if it produces log output when Flag.VERBOSE is true.
 */

import { Flag } from '../js/src/flag/flag';
import { Log } from '../js/src/util/log';

// Enable verbose mode FIRST (before any logging)
Flag.setVerbose(true);
console.log('[TEST] Flag.VERBOSE =', Flag.VERBOSE);

// Test 1: Check if log.info outputs anything with direct (non-lazy) call
const log = Log.create({ service: 'test-verbose' });

// Initialize logging with verbose mode
console.log('[TEST] Before Log.init - calling log.info...');
log.info('Before init test', { foo: 'bar' });
console.log('[TEST] After log.info (before Log.init)');

// Now init the log system
console.log('[TEST] Initializing Log...');

// We need to provide Global.Path.log, let's set it up
import { Global } from '../js/src/global';

// Check if Global is initialized
try {
  const logPath = Global.Path.log;
  console.log('[TEST] Global.Path.log =', logPath);
} catch (e) {
  console.log('[TEST] Global.Path.log not available:', (e as Error).message);
  console.log('[TEST] Skipping Log.init - testing without it');
}

// Test 2: Simulate the verbose HTTP logging wrapper
console.log('\n[TEST] === Testing verbose HTTP wrapper simulation ===');

// Create a mock fetch that always succeeds
const mockFetch = async (input: any, init?: any): Promise<Response> => {
  console.log('[TEST][mockFetch] Called with URL:', typeof input === 'string' ? input : input.url);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

// Replicate the verbose wrapper from provider.ts
const wrappedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  console.log('[TEST][wrapper] Flag.VERBOSE =', Flag.VERBOSE);

  // Check verbose flag at call time — not at SDK creation time
  if (!Flag.VERBOSE) {
    console.log('[TEST][wrapper] VERBOSE IS FALSE - bypassing verbose logging');
    return mockFetch(input, init);
  }

  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const method = init?.method ?? 'GET';

  console.log('[TEST][wrapper] About to log HTTP request...');
  log.info('HTTP request', {
    method,
    url,
  });
  console.log('[TEST][wrapper] After log.info for HTTP request');

  const response = await mockFetch(input, init);

  log.info('HTTP response', {
    method,
    url,
    status: response.status,
  });
  console.log('[TEST][wrapper] After log.info for HTTP response');

  return response;
};

// Call the wrapped fetch
console.log('\n[TEST] Calling wrapped fetch...');
const result = await wrappedFetch('https://api.test.com/v1/messages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ test: true }),
});
console.log('[TEST] Wrapped fetch result status:', result.status);

console.log('\n[TEST] === DONE ===');
