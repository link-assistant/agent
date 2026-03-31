/**
 * Experiment: Test if globalThis.fetch monkey-patch works in Bun
 * when referenced via bare `fetch` in another module scope.
 *
 * This tests the hypothesis that the verbose fetch logging fails because
 * Bun doesn't resolve bare `fetch` to `globalThis.fetch` at runtime.
 */

// Capture fetch before patch
const originalFetch = globalThis.fetch;
console.log('1. globalThis.fetch before patch:', typeof globalThis.fetch);

// Simulate monkey-patch (like index.js line 808)
let patchCalled = false;
const patchedFetch = async (input: any, init?: any) => {
  patchCalled = true;
  console.log('  [PATCH] fetch intercepted:', typeof input === 'string' ? input : input?.url);
  return originalFetch(input, init);
};
globalThis.fetch = patchedFetch as typeof fetch;
(globalThis as any).__agentVerboseFetchInstalled = true;

console.log('2. globalThis.fetch after patch:', globalThis.fetch === patchedFetch);

// Simulate what provider.ts line 1199 does
function simulateGetSDK() {
  // This mirrors: const existingFetch = options['fetch'] ?? fetch;
  const options: Record<string, any> = {}; // No custom fetch
  const existingFetch = options['fetch'] ?? fetch;

  console.log('3. existingFetch === patchedFetch:', existingFetch === patchedFetch);
  console.log('4. existingFetch === globalThis.fetch:', existingFetch === globalThis.fetch);

  return existingFetch;
}

const resolvedFetch = simulateGetSDK();

// Test the resolved fetch
console.log('5. Testing resolved fetch...');
try {
  await resolvedFetch('https://httpbin.org/get');
  console.log('6. patchCalled:', patchCalled);
} catch (e: any) {
  console.log('6. Fetch error (expected in some envs):', e.message);
  console.log('   patchCalled:', patchCalled);
}

// Also test: what about `fetch` in a dynamic function
const dynamicCheck = new Function('return fetch === globalThis.fetch')();
console.log('7. Dynamic check (fetch === globalThis.fetch):', dynamicCheck);

console.log('\n=== CONCLUSION ===');
if (patchCalled) {
  console.log('PASS: globalThis.fetch monkey-patch works for bare `fetch` references');
} else {
  console.log('FAIL: bare `fetch` does NOT resolve to globalThis.fetch after patch');
}
