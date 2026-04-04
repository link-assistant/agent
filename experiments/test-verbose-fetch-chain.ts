/**
 * Experiment: Test the exact fetch chain used in production
 *
 * Simulates the full chain:
 * 1. Global fetch monkey-patch (verbose-fetch.ts createVerboseFetch)
 * 2. Provider SDK fetch option (provider.ts getSDK)
 * 3. RetryFetch wrapper
 * 4. Provider-level verbose wrapper (skip because globalPatch installed)
 * 5. SDK calling its fetch
 *
 * Tests whether HTTP requests get logged through the chain.
 */

import { config, setVerbose } from "../js/src/config/config";
import {
  createVerboseFetch,
  resetHttpCallCount,
  getHttpCallCount,
} from "../js/src/util/verbose-fetch";
import { Log } from "../js/src/util/log";

// Initialize the log system
await Log.init({
  print: true,
  level: "DEBUG",
  compactJson: false,
});

// Enable verbose
setVerbose(true);

// Step 1: Install global fetch monkey-patch (like index.js line 808)
const originalGlobalFetch = globalThis.fetch;
if (!(globalThis as any).__agentVerboseFetchInstalled) {
  globalThis.fetch = createVerboseFetch(globalThis.fetch, {
    caller: "global",
  });
  (globalThis as any).__agentVerboseFetchInstalled = true;
}

console.log("\n=== Setup Complete ===");
console.log("config.verbose:", config.verbose);
console.log(
  "__agentVerboseFetchInstalled:",
  !!(globalThis as any).__agentVerboseFetchInstalled,
);

// Step 2: Simulate getSDK for opencode provider (no custom fetch)
const options: Record<string, any> = { apiKey: "public" };

// Line 1199: const existingFetch = options['fetch'] ?? fetch;
const existingFetch = options["fetch"] ?? fetch;
console.log(
  "\nexistingFetch === globalThis.fetch:",
  existingFetch === globalThis.fetch,
);

// Line 1200: options['fetch'] = RetryFetch.wrap(existingFetch, { sessionID: 'opencode' });
// Simplified retry wrapper (just passes through)
const retryWrappedFetch = async (
  input: RequestInfo | URL,
  init?: RequestInit,
) => {
  return existingFetch(input, init);
};
options["fetch"] = retryWrappedFetch;

// Line 1224-1237: Provider-level verbose wrapper
const innerFetch = options["fetch"];
const providerWrappedFetch = async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  // This is the exact check from provider.ts line 1233-1237
  if (!config.verbose || (globalThis as any).__agentVerboseFetchInstalled) {
    return innerFetch(input, init);
  }
  console.log("[PROVIDER] verbose logging would happen here");
  return innerFetch(input, init);
};
options["fetch"] = providerWrappedFetch;

// Step 3: Simulate what the SDK does
console.log("\n=== Making test HTTP call ===");
resetHttpCallCount();

try {
  const response = await options["fetch"]("https://httpbin.org/post", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ test: true }),
  });
  console.log("\nResponse status:", response.status);
  console.log(
    "HTTP call count (should be 1 if verbose logging worked):",
    getHttpCallCount(),
  );
} catch (e: any) {
  console.log("\nFetch error:", e.message);
  console.log("HTTP call count:", getHttpCallCount());
}

// Cleanup
globalThis.fetch = originalGlobalFetch;
delete (globalThis as any).__agentVerboseFetchInstalled;
