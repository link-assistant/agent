import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(
  new URL('../../js/package.json', import.meta.url)
);
const { $, raw } = require('command-stream');

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
  const cmd = $({ cwd, mirror: false, stdin: 'ignore' })`${raw(command)}`;
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
