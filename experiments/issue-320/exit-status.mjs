// Show how command-stream reports exit code and signal for normal exits,
// signal deaths, and AbortSignal cancellation (compared with child_process).
import { $, raw } from 'command-stream';
import { spawn } from 'node:child_process';

async function viaCommandStream(cmd, signal) {
  const run = $({ signal, killSignal: 'SIGTERM', killGrace: 200, mirror: false, capture: true, stdin: 'ignore' })`${raw(cmd)}`;
  let exit;
  for await (const chunk of run.stream()) if (chunk.type === 'exit') exit = chunk.code;
  return { exit, resultCode: run.result?.code, childExit: run.child?.exitCode, childSignal: run.child?.signalCode };
}
function viaSpawn(cmd, signal) {
  return new Promise((resolve) => {
    const p = spawn(cmd, { shell: true, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    signal?.addEventListener('abort', () => process.kill(-p.pid, 'SIGTERM'));
    p.on('close', () => resolve({ exit: p.exitCode, signal: p.signalCode }));
  });
}
for (const [name, cmd, mk] of [
  ['exit 3', 'exit 3'],
  ['self SIGKILL', 'kill -9 $$'],
  ['self SIGTERM', 'kill -15 $$'],
  ['abort sleep', 'sleep 5', () => AbortSignal.timeout(200)],
]) {
  console.log(name, 'command-stream', JSON.stringify(await viaCommandStream(cmd, mk?.())), 'spawn', JSON.stringify(await viaSpawn(cmd, mk?.())));
}
