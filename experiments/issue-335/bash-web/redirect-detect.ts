// Candidate write-redirect detector for the fork's tree-sitter bash scan.
//   cd js && bun ../experiments/issue-335/bash-web/redirect-detect.ts
import { fileURLToPath } from 'url';
const req = (s: string) => fileURLToPath(import.meta.resolve(s, new URL('../../../js/src/tool/bash.ts', import.meta.url).href));
const { Parser, Language } = await import(req('web-tree-sitter'));
let treePath: string;
try { treePath = req('web-tree-sitter/web-tree-sitter.wasm'); } catch { treePath = req('web-tree-sitter/tree-sitter.wasm'); }
await Parser.init({ locateFile: () => treePath });
const p = new Parser();
p.setLanguage(await Language.load(req('tree-sitter-bash/tree-sitter-bash.wasm')));

const WRITE_OPS = new Set(['>', '>>', '>|', '&>', '&>>', '>&']);
function writesFile(root: any): string[] {
  const hits: string[] = [];
  for (const r of root.descendantsOfType('file_redirect')) {
    if (!r) continue;
    let op = '';
    for (let i = 0; i < r.childCount; i++) {
      const c = r.child(i);
      if (c && WRITE_OPS.has(c.type)) op = c.type;
    }
    const dest = r.childForFieldName('destination')?.text ?? r.lastChild?.text ?? '';
    if (!op) continue;                      // '<' input redirect
    if (dest === '/dev/null') continue;     // discard
    if (op === '>&' && /^\d+$|^-$/.test(dest)) continue; // 2>&1 fd dup
    hits.push(r.text);
  }
  return hits;
}
for (const cmd of ['echo hi > x.txt', 'cat a >> b', 'ls 2>/dev/null', 'ls 2>&1 | head', 'grep x < in.txt',
  '{ echo a; } > f', 'echo $(date) &> log', 'cat <<EOF\nhi\nEOF', 'ls >| f']) {
  const tree = p.parse(cmd);
  console.log(JSON.stringify(cmd).padEnd(28), '->', JSON.stringify(writesFile(tree.rootNode)));
  tree.delete();
}
