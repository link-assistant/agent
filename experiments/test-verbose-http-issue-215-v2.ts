/**
 * Experiment v2: Test verbose HTTP logging with Log.init() called
 * Related to: https://github.com/link-assistant/agent/issues/215
 */

import { Flag } from '../js/src/flag/flag';
import { Log } from '../js/src/util/log';

// Enable verbose mode
Flag.setVerbose(true);
console.error('[TEST] Flag.VERBOSE =', Flag.VERBOSE);

// Initialize logging (like the middleware does)
await Log.init({
  print: Flag.VERBOSE,
  level: Flag.VERBOSE ? 'DEBUG' : 'INFO',
});
console.error('[TEST] Log.init() complete');

// Create logger (like provider.ts does)
const log = Log.create({ service: 'test-provider' });

// Test direct log.info call (non-lazy)
console.error('[TEST] Calling log.info with string message + extra...');
log.info('HTTP request', {
  method: 'POST',
  url: 'https://api.test.com/v1/messages',
});
console.error('[TEST] Done with log.info');

// Test lazy log.info call
console.error('[TEST] Calling lazy log.info...');
log.info(() => ({
  message: 'lazy HTTP test',
  method: 'GET',
}));
console.error('[TEST] Done with lazy log.info');

console.error('\n[TEST] === DONE ===');
