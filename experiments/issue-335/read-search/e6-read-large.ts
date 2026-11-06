// read.ts L127 + L141: a large text file is fully loaded (arrayBuffer for the binary sniff, then text().split).
import fs from 'fs';
const f = '/tmp/issue-335-read-search/fx-big.log';
fs.writeFileSync(f, ('x'.repeat(99) + '\n').repeat(3_000_000)); // 300 MB, 3M lines
const m0 = process.memoryUsage();
const t0 = performance.now();
const ab = await Bun.file(f).arrayBuffer();
new Uint8Array(ab.slice(0, 4096));
const lines = await Bun.file(f)
  .text()
  .then((t) => t.split('\n'));
const m1 = process.memoryUsage();
console.log(
  `lines=${lines.length} time=${(performance.now() - t0).toFixed(0)}ms rss+${((m1.rss - m0.rss) / 2 ** 20).toFixed(0)}MiB heap+${((m1.heapUsed - m0.heapUsed) / 2 ** 20).toFixed(0)}MiB arrayBuffers+${((m1.arrayBuffers - m0.arrayBuffers) / 2 ** 20).toFixed(0)}MiB`
);
fs.rmSync(f);
