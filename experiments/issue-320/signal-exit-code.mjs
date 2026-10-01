// command-stream 1.3.0: a shell-mode file/args command whose process dies from
// a signal reports exit code 0, and the result has no documented field with the
// terminating signal. Node's child_process reports exitCode null with
// signalCode SIGTERM/SIGKILL for the same commands.
// Run: node experiments/issue-320/signal-exit-code.mjs (or bun)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(
  new URL('../../js/package.json', import.meta.url)
);
const { ProcessRunner } = require('command-stream/process-runner');

function nodeSpawn(command) {
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, stdio: 'ignore' });
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

for (const command of ['kill -TERM $$', 'kill -KILL $$', 'exit 3']) {
  const runner = new ProcessRunner(
    { mode: 'shell', file: command, args: [] },
    { mirror: false, capture: true, stdin: 'ignore' }
  );
  const result = await runner;
  console.log(
    JSON.stringify({
      command,
      commandStream: { code: result.code },
      undocumentedChildSignal: result.child?.signalCode ?? null,
      childProcess: await nodeSpawn(command),
    })
  );
}
