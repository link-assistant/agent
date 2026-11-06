import fs from 'fs';
import path from 'path';
const base = '/tmp/issue-335-read-search/fx-read2';
fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(base, { recursive: true });

// (a) read.ts L39-41: relative path joined with Instance.worktree; project.ts L37/L72 sets worktree '/' outside git.
const worktree = '/',
  directory = base;
console.log(
  '(a) ours:',
  path.join(worktree, 'notes/todo.md'),
  ' upstream 6cf2c3e3db:',
  path.resolve(directory, 'notes/todo.md')
);

// (b) macOS screenshot name uses U+202F before AM/PM; the model types a plain space.
const real = 'Screenshot 2026-10-22 at 9.41.07 AM.png';
fs.writeFileSync(path.join(base, real), 'x');
const typed = path.join(base, 'Screenshot 2026-10-22 at 9.41.07 AM.png');
console.log('(b) ours exists():', await Bun.file(typed).exists());
const canonical = (n: string) =>
  n.normalize('NFC').replace(/[  ]/g, ' ').replace(/[‘’]/g, "'");
const hits = fs
  .readdirSync(base, { withFileTypes: true })
  .filter(
    (e) => e.isFile() && canonical(e.name) === canonical(path.basename(typed))
  );
console.log(
  '    upstream alternatePath finds:',
  hits.length === 1 ? JSON.stringify(hits[0].name) : 'none'
);
// our suggestion heuristic (L51-58) does substring match only -> no suggestion
const b = path.basename(typed).toLowerCase();
console.log(
  '    ours suggestions:',
  fs
    .readdirSync(base)
    .filter((e) => e.toLowerCase().includes(b) || b.includes(e.toLowerCase()))
);

// (c) read.ts L141 / L174: split('\n') on CRLF + trailing newline
fs.writeFileSync(path.join(base, 'crlf.txt'), 'a\r\nb\r\n');
const lines = (await Bun.file(path.join(base, 'crlf.txt')).text()).split('\n');
console.log(
  '(c) ours lines:',
  JSON.stringify(lines),
  'total reported:',
  lines.length,
  '(file has 2 lines)'
);

// (d) read.ts L432: isBinaryFile reads the whole file to sample 4096 bytes
const big = path.join(base, 'big.log');
fs.writeFileSync(big, Buffer.alloc(300 * 1024 * 1024, 'a'));
const before = process.memoryUsage().rss;
const t0 = performance.now();
const buf = await Bun.file(big).arrayBuffer();
const sample = new Uint8Array(buf.slice(0, 4096));
console.log(
  `(d) arrayBuffer() for a 4096-byte sample: +${((process.memoryUsage().rss - before) / 2 ** 20).toFixed(0)} MiB RSS, ${(performance.now() - t0).toFixed(0)} ms, sample=${sample.length}`
);
const fh = fs.openSync(big, 'r');
const s = Buffer.alloc(4096);
fs.readSync(fh, s, 0, 4096, 0);
fs.closeSync(fh);
console.log(
  '    fs.readSync sample (upstream c1b03b728a): 4096 bytes, no whole-file allocation'
);
fs.rmSync(base, { recursive: true, force: true });
