// Proves lost update when two edit tool calls hit the same file concurrently
// (AI SDK executes multiple tool calls of one step concurrently; batch tool uses Promise.all).
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
const SRC = new URL('../../../js/src', import.meta.url).pathname;
const { Instance } = await import(SRC + '/project/instance.ts');
const { EditTool } = await import(SRC + '/tool/edit.ts');
const { FileTime } = await import(SRC + '/file/time.ts');
const dir = path.join(os.tmpdir(), 'issue-335-par');
await fs.rm(dir, { recursive: true, force: true });
await fs.mkdir(dir, { recursive: true });
const file = path.join(dir, 'file.txt');
let lost = 0,
  errors = 0;
const N = 20;
await Instance.provide({
  directory: dir,
  fn: async () => {
    const edit = await EditTool.init();
    for (let i = 0; i < N; i++) {
      await fs.writeFile(file, 'top = 0\nmiddle = keep\nbottom = 0\n');
      await Bun.sleep(5);
      FileTime.read('s', file);
      const ctx = {
        sessionID: 's',
        messageID: 'm',
        agent: 'build',
        abort: new AbortController().signal,
        metadata() {},
      };
      const r = await Promise.allSettled([
        edit.execute(
          { filePath: file, oldString: 'top = 0', newString: 'top = 1' },
          ctx
        ),
        edit.execute(
          { filePath: file, oldString: 'bottom = 0', newString: 'bottom = 2' },
          ctx
        ),
      ]);
      const out = await fs.readFile(file, 'utf8');
      if (r.some((x) => x.status === 'rejected')) errors++;
      else if (out !== 'top = 1\nmiddle = keep\nbottom = 2\n') {
        lost++;
        if (lost === 1) console.log('example result:', JSON.stringify(out));
      }
    }
  },
});
console.log(
  `runs=${N} both-fulfilled-but-one-edit-lost=${lost} rejected=${errors}`
);
