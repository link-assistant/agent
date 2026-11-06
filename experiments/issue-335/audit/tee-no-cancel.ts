// Confirms that breaking out of a tee() branch without reader.cancel() makes
// that branch buffer every later chunk while the other branch is consumed.
// Mirrors provider.ts (non-verbose path): usage reader stops after 50 KB.
// Run: cd js && timeout 60 bun ../experiments/issue-335/audit/tee-no-cancel.ts
const CHUNK = 64 * 1024;
const CHUNKS = 400; // 25 MB "response"

function source() {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (i++ >= CHUNKS) return c.close();
      c.enqueue(new Uint8Array(CHUNK).fill(97));
    },
  });
}

async function run(cancel: boolean) {
  Bun.gc(true);
  const base = process.memoryUsage().rss;
  const [sdk, usage] = source().tee();
  const usageDone = (async () => {
    const reader = usage.getReader();
    let body = '';
    const dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      body += dec.decode(value, { stream: true });
      if (body.length > 50000) break;
    }
    // Not awaited: per the Streams spec a tee branch's cancel() promise
    // settles only when the other branch is also cancelled or the source ends.
    if (cancel) reader.cancel().catch(() => {});
  })();
  await usageDone;
  // SDK branch consumes the whole response; sample memory near the end.
  const r = sdk.getReader();
  let n = 0;
  let peak = 0;
  while (true) {
    const { done } = await r.read();
    if (done) break;
    if (++n % 50 === 0) {
      Bun.gc(true);
      peak = Math.max(peak, process.memoryUsage().rss - base);
    }
  }
  return Math.round(peak / 1024 / 1024);
}

const withCancel = await run(true);
const noCancel = await run(false);
console.log(`peak extra RSS, break+cancel: ${withCancel} MB`);
console.log(`peak extra RSS, break only:   ${noCancel} MB (response is ${(CHUNK * CHUNKS) / 1024 / 1024} MB)`);
console.log(noCancel > withCancel + 10 ? 'CONFIRMED: uncancelled branch buffers the response' : 'NOT CONFIRMED');
