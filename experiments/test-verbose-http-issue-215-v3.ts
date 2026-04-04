/**
 * Experiment v3: Test if logger created BEFORE Log.init() still works after init
 * Related to: https://github.com/link-assistant/agent/issues/215
 */

import { config, setVerbose } from "../js/src/config/agent-config";
import { Log } from "../js/src/util/log";

// Create logger BEFORE Log.init() (simulates provider.ts module-level creation)
const log = Log.create({ service: "provider" });

console.error("[TEST] Logger created before Log.init()");
console.error("[TEST] Calling log.info BEFORE init...");
log.info("HTTP request BEFORE init", { method: "POST" });
console.error("[TEST] (nothing should appear above from log.info)");

// Now enable verbose and init (like middleware does)
setVerbose(true);
await Log.init({
  print: config.verbose,
  level: "DEBUG",
});
console.error("[TEST] Log.init() complete, config.verbose =", config.verbose);

// Now test if the SAME logger works after init
console.error("[TEST] Calling log.info AFTER init...");
log.info("HTTP request AFTER init", {
  method: "POST",
  url: "https://api.test.com",
});
console.error("[TEST] Done");

// Also test: create a SECOND logger with same service name (should return cached one)
const log2 = Log.create({ service: "provider" });
console.error("[TEST] Same logger? ", log === log2);

log2.info("HTTP request from cached logger", { method: "GET" });
console.error("[TEST] === DONE ===");
