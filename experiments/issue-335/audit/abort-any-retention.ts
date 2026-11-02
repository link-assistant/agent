// Checks whether AbortSignal.any([longLived, AbortSignal.timeout(T)]) with an
// abort listener (as command-stream adds for bash's `signal`) keeps the
// listener's closure alive after the tool call finishes, while the parent
// (session abort) signal stays alive.
// Run: cd js && timeout 90 bun ../experiments/issue-335/audit/abort-any-retention.ts
const N = 200;
const PAYLOAD = 256 * 1024; // stands in for a runner's captured output
const parent = new AbortController(); // session-lifetime signal

let collected = 0;
const reg = new FinalizationRegistry(() => collected++);

function call(withTimeout: boolean, withListener: boolean, ms = 60_000) {
  const sources: AbortSignal[] = [parent.signal];
  if (withTimeout) sources.push(AbortSignal.timeout(ms));
  const s = AbortSignal.any(sources);
  const payload = new Uint8Array(PAYLOAD);
  if (withListener) s.addEventListener('abort', () => payload.length);
  reg.register(payload, 0);
}

async function trial(name: string, withTimeout: boolean, withListener: boolean, ms = 60_000, wait = 0) {
  collected = 0;
  for (let i = 0; i < N; i++) call(withTimeout, withListener, ms);
  if (wait) await Bun.sleep(wait);
  for (let i = 0; i < 5; i++) {
    Bun.gc(true);
    await Bun.sleep(20);
  }
  console.log(`${name.padEnd(36)} payloads collected ${collected}/${N}`);
  return collected;
}

await trial('any([parent]) no listener', false, false);
const a = await trial('any([parent]) + listener', false, true);
const b = await trial('any([parent, timeout]) + listener', true, true);
// After the timeout fires, the dependent is aborted and the listener ran.
await trial('any([parent, timeout 200ms]) fired', true, true, 200, 1000);
console.log(
  a < N / 2 || b < N / 2
    ? 'CONFIRMED: listener closures retained while parent lives'
    : 'NOT CONFIRMED: closures collected'
);
process.exit(0);
