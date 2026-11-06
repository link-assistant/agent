// Can the bash tool run the command through an explicit shell (exec mode,
// [shell, '-c', command]) with the same streaming + group-kill behaviour?
//   bun experiments/issue-335/bash-web/shell-exec-mode.ts
import { ProcessRunner } from '../../../js/node_modules/command-stream/src/process-runner.mjs';
const shell = Bun.which('bash') ?? '/bin/sh';
async function run(command: string, ms: number) {
  const r = new ProcessRunner({ mode: 'exec', file: shell, args: ['-c', command] },
    { signal: AbortSignal.timeout(ms), killSignal: 'SIGTERM', killGrace: 200, mirror: false, capture: true, stdin: 'ignore' });
  let out = '', code: any;
  for await (const c of r.stream()) c.type === 'exit' ? (code = c.code) : (out += c.data.toString());
  return { out, code };
}
console.log('shell', shell, await run('echo {1..3}; [[ 1 == 1 ]] && echo bashism-ok', 5000));
const t0 = Date.now();
console.log(await run('(sleep 3; echo grandchild-survived > /tmp/expC-gc.txt) & echo started; wait', 300), 'ms', Date.now() - t0);
await Bun.sleep(3500);
console.log('grandchild survived timeout kill?', await Bun.file('/tmp/expC-gc.txt').exists());
