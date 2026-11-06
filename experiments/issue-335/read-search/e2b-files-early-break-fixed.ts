// Proves whether Ripgrep.files() (js/src/file/ripgrep.ts L220-277) keeps rg running / blocks
// after the consumer breaks early (glob.ts L32-34 breaks at 100 results).
import fs from 'fs';
const RG = process.env.HOME + '/.local/share/link-assistant-agent/bin/rg';
const dir = '/tmp/issue-335-read-search/fx-many';
const N = Number(process.env.N ?? 150000);
if (!fs.existsSync(dir + '/done')) {
  fs.mkdirSync(dir, { recursive: true });
  for (let d = 0; d < N / 1000; d++) {
    fs.mkdirSync(`${dir}/d${d}`, { recursive: true });
    for (let i = 0; i < 1000; i++)
      fs.writeFileSync(
        `${dir}/d${d}/some-reasonably-long-file-name-${i}.txt`,
        ''
      );
  }
  fs.writeFileSync(dir + '/done', '');
}
// --- copied verbatim (minus ENOENT check) from Ripgrep.files ---
async function* files(input: { cwd: string; glob?: string[] }) {
  const args = [RG, '--files', '--follow', '--hidden', '--glob=!.git/*'];
  for (const g of input.glob ?? []) args.push(`--glob=${g}`);
  const proc = Bun.spawn(args, {
    cwd: input.cwd,
    stdout: 'pipe',
    stderr: 'ignore',
    maxBuffer: 1024 * 1024 * 20,
  });
  (globalThis as any).proc = proc;
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) if (line) yield line;
    }
    if (buffer) yield buffer;
  } finally {
    await reader.cancel().catch(() => {});
    if (proc.exitCode === null) proc.kill();
    await proc.exited;
  }
}
const t0 = performance.now();
const timer = setTimeout(() => {
  console.log(
    `HANG: still waiting after 10s; rg pid ${(globalThis as any).proc.pid} exitCode=${(globalThis as any).proc.exitCode}`
  );
  (globalThis as any).proc.kill();
}, 10000);
let n = 0;
for await (const f of files({ cwd: dir, glob: ['*.txt'] })) {
  if (++n >= 100) break;
}
clearTimeout(timer);
console.log(
  `collected ${n} in ${(performance.now() - t0).toFixed(0)} ms; rg exitCode=${(globalThis as any).proc.exitCode} signal=${(globalThis as any).proc.signalCode}`
);
