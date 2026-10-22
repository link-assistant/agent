// read.ts L45-67 (missing-file branch) and L127/L141 (binary check / text read) on edge paths.
import fs from 'fs';
import path from 'path';
const base = '/tmp/issue-335-read-search/fx-read';
fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(base + '/subdir', { recursive: true });
async function oursMissing(filepath: string) {
  const file = Bun.file(filepath);
  if (!(await file.exists())) {
    const dir = path.dirname(filepath);
    const base = path.basename(filepath);
    const dirEntries = fs.readdirSync(dir);
    const suggestions = dirEntries
      .filter(
        (e) =>
          e.toLowerCase().includes(base.toLowerCase()) ||
          base.toLowerCase().includes(e.toLowerCase())
      )
      .map((e) => path.join(dir, e))
      .slice(0, 3);
    if (suggestions.length > 0)
      throw new Error(
        `File not found: ${filepath}\n\nDid you mean one of these?\n${suggestions.join('\n')}`
      );
    throw new Error(`File not found: ${filepath}`);
  }
  // past exists(): our code calls isBinaryFile -> file.stat()/file.arrayBuffer(), then file.text()
  const st = await file.stat();
  await file.arrayBuffer();
  return `read ${st.size} bytes`;
}
for (const p of [base + '/no-such-dir/a.ts', base + '/subdir']) {
  try {
    console.log(p, '->', await oursMissing(p));
  } catch (e: any) {
    console.log(
      p,
      '-> THROWS',
      JSON.stringify(e.message.split('\n')[0]),
      e.code ?? ''
    );
  }
}
