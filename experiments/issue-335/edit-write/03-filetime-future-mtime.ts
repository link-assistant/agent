// Proves FileTime.assert compares file mtime against the wall-clock read time:
// a file whose mtime is in the future (clock skew, NFS/SMB/docker mounts, `touch -d`,
// archives extracted with future timestamps) can never be edited, even right after reading it.
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
const SRC = new URL('../../../js/src', import.meta.url).pathname;
const { Instance } = await import(SRC + '/project/instance.ts');
const { EditTool } = await import(SRC + '/tool/edit.ts');
const { FileTime } = await import(SRC + '/file/time.ts');
const dir = path.join(os.tmpdir(), 'issue-335-ft');
await fs.rm(dir, { recursive: true, force: true });
await fs.mkdir(dir, { recursive: true });
const f = path.join(dir, 'a.txt');
await fs.writeFile(f, 'hello\n');
const future = new Date(Date.now() + 60_000);
await fs.utimes(f, future, future);
const ctx = {
  sessionID: 's',
  messageID: 'm',
  agent: 'build',
  abort: new AbortController().signal,
  metadata() {},
};
await Instance.provide({
  directory: dir,
  fn: async () => {
    const edit = await EditTool.init();
    FileTime.read('s', f); // what the read tool does
    try {
      await edit.execute(
        { filePath: f, oldString: 'hello', newString: 'bye' },
        ctx
      );
      console.log('edit OK');
    } catch (e) {
      console.log('edit FAILED right after read:', String(e).split('\n')[0]);
    }
    // Also: two path spellings of the same file are tracked separately
    FileTime.read('s', f);
    try {
      await edit.execute(
        { filePath: dir + '/./a.txt', oldString: 'bye', newString: 'hello' },
        ctx
      );
      console.log('edit via non-normalized path OK');
    } catch (e) {
      console.log(
        'edit via non-normalized path FAILED:',
        String(e).split('\n')[0]
      );
    }
  },
});
