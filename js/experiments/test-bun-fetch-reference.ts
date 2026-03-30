/**
 * Test: Does unqualified `fetch` in Bun resolve to current globalThis.fetch
 * or the module-load-time reference?
 */

console.log('=== Testing fetch reference behavior in Bun ===');

const originalFetch = globalThis.fetch;
let patchCallCount = 0;

function callFetch() {
  // Does `fetch` here resolve to current globalThis.fetch?
  return typeof fetch === 'function' ? 'function' : typeof fetch;
}

function getFetchRef() {
  return fetch;
}

console.log('Before patch:', callFetch());
const ref1 = getFetchRef();

// Monkey-patch
globalThis.fetch = (async (input: any, init?: any) => {
  patchCallCount++;
  console.log('PATCHED FETCH CALLED');
  return new Response('patched');
}) as typeof fetch;

console.log('After patch:', callFetch());
const ref2 = getFetchRef();

console.log('Same reference?', ref1 === ref2);
console.log('ref2 === globalThis.fetch?', ref2 === globalThis.fetch);

// Call unqualified fetch
try {
  await fetch('http://localhost:1/test');
} catch (e) {
  console.log(
    'fetch error (expected):',
    (e as Error).message?.substring(0, 50)
  );
}
console.log('Patch call count:', patchCallCount);

if (patchCallCount > 0) {
  console.log('✅ Unqualified `fetch` resolves to current globalThis.fetch');
} else {
  console.log('❌ Unqualified `fetch` is a captured reference (not live)');
}

globalThis.fetch = originalFetch;
