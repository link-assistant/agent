// Does the fork's bash tool corrupt multi-byte UTF-8 split across stream chunks
// (bash.ts:185 `chunk.data.toString()` per chunk; upstream decodes as a stream)?
//   bun experiments/issue-335/bash-web/bash-utf8-split.ts
const SRC = new URL('../../../js/src', import.meta.url).pathname;
const { BashTool } = await import(`${SRC}/tool/bash`);
const { Instance } = await import(`${SRC}/project/instance`);
let meta = '';
await Instance.provide({ directory: '/tmp', fn: async () => {
  const tool = await BashTool.init();
  await tool.execute({ command: "for i in $(seq 1 3); do head -c 30000 /dev/zero | tr '\\0' 'x'; printf '\\342\\202'; sleep 0.2; printf '\\254'; done", description: 'exp' },
    { sessionID: 's', messageID: 'm', agent: 'build', abort: new AbortController().signal,
      metadata(v: any) { meta = v.metadata?.output ?? meta; } });
}});
console.log('euro signs expected 3, intact:', (meta.match(/€/g) ?? []).length, 'replacement chars:', (meta.match(/�/g) ?? []).length);
await Instance.disposeAll();
