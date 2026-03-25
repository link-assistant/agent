/**
 * Experiment: Test the exact verbose wrapper code path from provider.ts
 * to verify whether log.info('HTTP request', ...) actually produces output.
 *
 * Issue: https://github.com/link-assistant/agent/issues/215
 */

import { Flag } from '../src/flag/flag';
import { Log } from '../src/util/log';

// Set verbose mode
Flag.setVerbose(true);

// Initialize logging
await Log.init({
  print: true,
  level: 'DEBUG',
});

const log = Log.create({ service: 'provider' });

// Simulate the verbose wrapper
let verboseWrapperConfirmed = false;

const wrappedFetch = async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
  // Check verbose flag at call time
  if (!Flag.OPENCODE_VERBOSE) {
    console.error('[TEST] Flag.OPENCODE_VERBOSE is false — wrapper is no-op');
    return fetch(input, init);
  }

  // Breadcrumb
  if (!verboseWrapperConfirmed) {
    verboseWrapperConfirmed = true;
    log.info('verbose HTTP logging active', { providerID: 'opencode' });
  }

  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as any).url;
  const method = init?.method ?? 'GET';

  // Log HTTP request (direct, not lazy)
  log.info('HTTP request', {
    providerID: 'opencode',
    method,
    url,
  });

  // Mock response
  return new Response(JSON.stringify({ test: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

console.log('\n=== Testing verbose HTTP wrapper log output ===');
console.log(`Flag.OPENCODE_VERBOSE = ${Flag.OPENCODE_VERBOSE}`);
console.log('Calling wrappedFetch...\n');

await wrappedFetch('https://api.example.com/test', { method: 'POST' });

console.log('\n=== Done ===');
console.log('If you see "HTTP request" JSON log above, the wrapper works.');
console.log(
  'If you only see this message, the log.info() call is silently dropped.'
);
