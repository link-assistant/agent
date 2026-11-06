// Confirms that SSEUsageExtractor.pendingUsage grows by one entry per SSE
// request that carries usage, when the SDK already reported tokens (so the
// only consumer, consumeLatestUsage in processor.ts, never runs).
// Run: cd js && timeout 60 bun ../experiments/issue-335/audit/sse-usage-growth.ts
const src = new URL('../../../js/src', import.meta.url).pathname;
const { SSEUsageExtractor } = await import(`${src}/util/sse-usage-extractor.ts`);

const body =
  'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' +
  'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n' +
  'data: [DONE]\n\n';

const N = 1000; // simulated LLM steps
for (let i = 0; i < N; i++) {
  // same calls provider.ts makes per streamed response
  SSEUsageExtractor.processStreamForUsage(SSEUsageExtractor.nextRequestId(), body);
}
let entries = 0;
for (let i = 1; i <= N + 5; i++) if (SSEUsageExtractor.getUsage(`sse-req-${i}`)) entries++;
console.log(`steps=${N} retained entries=${entries}`);
// consumeLatestUsage removes only one entry; stale entries remain.
SSEUsageExtractor.consumeLatestUsage();
let after = 0;
for (let i = 1; i <= N + 5; i++) if (SSEUsageExtractor.getUsage(`sse-req-${i}`)) after++;
console.log(`after one consumeLatestUsage: ${after}`);
console.log(entries === N ? 'CONFIRMED: map grows per request' : 'NOT CONFIRMED');
