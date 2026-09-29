import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const child = fileURLToPath(
  new URL('./process-tree-child.mjs', import.meta.url)
);
const childProcess = spawn(
  globalThis.process.execPath,
  [child, globalThis.process.argv[2]],
  {
    stdio: 'ignore',
  }
);
while (!existsSync(globalThis.process.argv[2])) await sleep(10);
console.log(`CHILD_PID=${childProcess.pid}`);
setInterval(() => {}, 1000);
