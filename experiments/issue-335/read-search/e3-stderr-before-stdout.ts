// Does reading stdout fully before stderr (grep.ts L52-53) deadlock if the child fills stderr first?
const proc = Bun.spawn(
  ['sh', '-c', 'head -c 2000000 /dev/zero | tr "\\0" x >&2; echo done'],
  { stdout: 'pipe', stderr: 'pipe' }
);
const timer = setTimeout(() => {
  console.log('DEADLOCK after 5s');
  proc.kill();
}, 5000);
const out = await new Response(proc.stdout).text();
const err = await new Response(proc.stderr).text();
clearTimeout(timer);
console.log({ out: out.trim(), errBytes: err.length, exit: await proc.exited });
