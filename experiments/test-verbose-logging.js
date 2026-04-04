// Test: Simulate the exact flow from Log.create + Log.init + verbose fetch logging
import { Log } from '../js/src/util/log.ts';
import { config, setVerbose } from '../js/src/config/agent-config.ts';

// Step 1: Create a logger BEFORE init (like provider.ts does at module level)
const log = Log.create({ service: 'provider-test' });

console.log("=== Step 1: Logger created before init ===");

// Step 2: Test lazy logging before init
log.info(() => ({
  message: 'HTTP request (BEFORE INIT)',
  method: 'POST',
  url: 'https://api.example.com/test',
}));
console.log("--- After lazy log before init (should be silent) ---");

// Step 3: Enable verbose and init
console.log("\n=== Step 3: Enabling verbose + Log.init ===");
setVerbose(true);
await Log.init({
  print: true,
  level: 'DEBUG',
});

// Step 4: Test lazy logging after init
console.log("\n=== Step 4: Lazy log after init (should appear) ===");
log.info(() => ({
  message: 'HTTP request (AFTER INIT)',
  method: 'POST',
  url: 'https://api.example.com/test',
}));
console.log("--- After lazy log after init ---");

// Step 5: Test non-lazy logging
console.log("\n=== Step 5: Non-lazy log (should appear) ===");
log.info('Direct string message');

// Step 6: Test debug logging
console.log("\n=== Step 6: Debug log (should appear in verbose) ===");
log.debug(() => ({
  message: 'Debug message',
  detail: 'verbose detail',
}));

console.log("\n=== DONE ===");
