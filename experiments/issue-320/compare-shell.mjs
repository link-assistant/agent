import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(
  new URL('../../js/package.json', import.meta.url)
);
const { ProcessRunner } = require('command-stream/process-runner');

function original(command, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, cwd });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk.toString()));
    child.stderr.on('data', (chunk) => (output += chunk.toString()));
    child.once('error', reject);
    child.once('exit', (code) => resolve({ output, code }));
  });
}

async function replacement(command, cwd) {
  // Same invocation as js/src/tool/bash.ts: the file/args shell form runs
  // the string through the platform shell instead of command-stream builtins.
  const cmd = new ProcessRunner(
    { mode: 'shell', file: command, args: [] },
    { cwd, mirror: false, capture: true, stdin: 'ignore' }
  );
  let output = '';
  let code = null;
  for await (const chunk of cmd.stream()) {
    if (chunk.type === 'exit') code = chunk.code;
    else output += chunk.data.toString();
  }
  return { output, code };
}

const cases = [
  'echo alpha && echo beta',
  "printf 'a\\nb\\n' | tail -n 1",
  "node -e \"console.log(process.env.HOME ? 'home' : 'missing')\"",
  "printf 'file' > sample.txt && cat sample.txt",
  'cd sub && pwd',
  'for x in a b; do echo "$x"; done',
  'echo *.txt',
  'export ISSUE320_TEST=ok; echo "$ISSUE320_TEST"',
  // command-stream's `$` routes these to JavaScript builtins.
  'exit 3',
  'ls missing-entry',
  'echo "$0"',
];

const directory = mkdtempSync(join(tmpdir(), 'issue-320-shell-'));
mkdirSync(join(directory, 'sub'));
writeFileSync(join(directory, 'glob.txt'), 'glob');
try {
  for (const command of cases) {
    const before = await original(command, directory);
    const after = await replacement(command, directory);
    console.log(
      JSON.stringify({
        command,
        matches: JSON.stringify(before) === JSON.stringify(after),
        before,
        after,
      })
    );
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
