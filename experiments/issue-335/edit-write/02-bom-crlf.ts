// Proves BOM loss and CRLF/LF mixing in our edit tool.
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
const SRC = new URL('../../../js/src', import.meta.url).pathname;
const { Instance } = await import(SRC + '/project/instance.ts');
const { EditTool } = await import(SRC + '/tool/edit.ts');
const { FileTime } = await import(SRC + '/file/time.ts');
const dir = path.join(os.tmpdir(), 'issue-335-bom');
await fs.rm(dir, { recursive: true, force: true });
await fs.mkdir(dir, { recursive: true });
const ctx = {
  sessionID: 's',
  messageID: 'm',
  agent: 'build',
  abort: new AbortController().signal,
  metadata() {},
};
const hex = (b: Buffer) => b.subarray(0, 3).toString('hex');
await Instance.provide({
  directory: dir,
  fn: async () => {
    const edit = await EditTool.init();
    // BOM
    const f1 = path.join(dir, 'bom.cs');
    await fs.writeFile(
      f1,
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from('using System;\nclass A {}\n'),
      ])
    );
    console.log(
      'Bun.file().text() first char code:',
      (await Bun.file(f1).text()).charCodeAt(0).toString(16)
    );
    FileTime.read('s', f1);
    await edit.execute(
      { filePath: f1, oldString: 'class A {}', newString: 'class B {}' },
      ctx
    );
    const b1 = await fs.readFile(f1);
    console.log(
      'BOM after edit: first 3 bytes =',
      hex(b1),
      b1[0] === 0xef ? 'BOM KEPT' : 'BOM LOST'
    );
    // CRLF multi-line edit
    const f2 = path.join(dir, 'crlf.txt');
    await fs.writeFile(f2, 'line1\r\nline2\r\nline3\r\n');
    FileTime.read('s', f2);
    await edit.execute(
      {
        filePath: f2,
        oldString: 'line1\nline2',
        newString: 'line1\nnew\nline2',
      },
      ctx
    );
    console.log(
      'CRLF after multi-line edit:',
      JSON.stringify(await fs.readFile(f2, 'utf8'))
    );
    // CRLF: oldString with LF, single-line match through exact
    const f3 = path.join(dir, 'crlf2.txt');
    await fs.writeFile(f3, 'a\r\nb\r\n');
    FileTime.read('s', f3);
    await edit.execute(
      { filePath: f3, oldString: 'a', newString: 'a\nx' },
      ctx
    );
    console.log(
      'CRLF after single-line insert:',
      JSON.stringify(await fs.readFile(f3, 'utf8'))
    );
  },
});
