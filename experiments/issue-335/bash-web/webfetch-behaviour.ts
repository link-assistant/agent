// Read-only experiment against the fork's WebFetchTool, using a local server.
//   bun experiments/issue-335/bash-web/webfetch-behaviour.ts
import z from 'zod';
const SRC = new URL('../../../js/src', import.meta.url).pathname;
const { WebFetchTool } = await import(`${SRC}/tool/webfetch`);
const { Instance } = await import(`${SRC}/project/instance`);

let sent = 0;
let cfCalls = 0;
const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/script')
      return new Response('<p>Hello <script>x()</script> world</p><p>tail</p>', {
        headers: { 'content-type': 'text/html' },
      });
    if (url.pathname === '/cf') {
      cfCalls++;
      if (req.headers.get('user-agent') !== 'opencode')
        return new Response('challenge', { status: 403, headers: { 'cf-mitigated': 'challenge' } });
      return new Response('real page', { headers: { 'content-type': 'text/plain' } });
    }
    if (url.pathname === '/trickle') {
      // headers immediately, then one byte every 250 ms for ~3 s
      let i = 0;
      return new Response(
        new ReadableStream({
          async pull(c) {
            await Bun.sleep(250);
            if (i++ >= 12) return c.close();
            c.enqueue(new TextEncoder().encode('x'));
          },
        }),
        { headers: { 'content-type': 'text/plain' } }
      );
    }
    if (url.pathname === '/huge') {
      // 20 MB chunked body, no content-length
      sent = 0;
      const chunk = new Uint8Array(1024 * 1024).fill(120);
      return new Response(
        new ReadableStream({
          pull(c) {
            if (sent >= 20) return c.close();
            sent++;
            c.enqueue(chunk);
          },
        }),
        { headers: { 'content-type': 'text/plain' } }
      );
    }
    return new Response('plain', { headers: { 'content-type': 'text/plain' } });
  },
});
const base = `http://127.0.0.1:${server.port}`;

async function call(args: any) {
  const t0 = performance.now();
  try {
    const res = await Instance.provide({
      directory: '/tmp',
      fn: async () =>
        (await WebFetchTool.init()).execute(args, {
          sessionID: 's',
          messageID: 'm',
          agent: 'build',
          abort: new AbortController().signal,
          metadata() {},
        }),
    });
    return { ok: JSON.stringify(res.output).slice(0, 90), ms: Math.round(performance.now() - t0) };
  } catch (e) {
    return { err: String(e).slice(0, 110), ms: Math.round(performance.now() - t0) };
  }
}

console.log('1. format omitted ->', await call({ url: `${base}/plain` }));
console.log('2. text of <p>Hello <script>..</script> world</p> ->', await call({ url: `${base}/script`, format: 'text' }));
console.log('3. cloudflare 403 challenge ->', await call({ url: `${base}/cf`, format: 'text' }), 'server calls', cfCalls);
console.log('4. timeout=1s, body trickles 3s ->', await call({ url: `${base}/trickle`, format: 'text', timeout: 1 }));
const r5 = await call({ url: `${base}/huge`, format: 'text' });
console.log('5. 20MB chunked body (limit 5MB) ->', r5, 'MB sent by server before failure:', sent);
// 6. What JSON schema does a zod .default() field produce (prompt.ts uses z.toJSONSchema)?
const s = z.object({ format: z.enum(['text', 'markdown', 'html']).default('markdown') });
console.log('6. required with .default():', (z.toJSONSchema(s) as any).required,
  '| io:input:', (z.toJSONSchema(s, { io: 'input' }) as any).required);
server.stop(true);
await Instance.disposeAll();
