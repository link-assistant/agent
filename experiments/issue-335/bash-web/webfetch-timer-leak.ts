// Does a failed fetch leave the webfetch timeout timer pending? (upstream bc1840b196, #21378)
//   bun experiments/issue-335/bash-web/webfetch-timer-leak.ts
// The process should exit right after the error; a leaked timer keeps it alive
// until the (8 s) timeout fires.
const SRC = new URL('../../../js/src', import.meta.url).pathname;
const { WebFetchTool } = await import(`${SRC}/tool/webfetch`);
const t0 = performance.now();
process.on('exit', () => console.log('process exit after ms', Math.round(performance.now() - t0)));
const tool = await WebFetchTool.init();
try {
  await tool.execute({ url: 'http://127.0.0.1:9/', format: 'text', timeout: 8 },
    { sessionID: 's', messageID: 'm', agent: 'build', abort: new AbortController().signal, metadata() {} } as any);
} catch (e) {
  console.log('fetch failed after ms', Math.round(performance.now() - t0), String(e).slice(0, 60));
}
