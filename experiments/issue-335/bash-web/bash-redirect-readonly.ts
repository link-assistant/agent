// Read-only experiment: in `readonly` permission mode, does the bash tool block
// a write done through an output redirect? Upstream context: e7ff7143b6 (#6737)
// handles the `redirected_statement` tree-sitter node. Run with:
//   bun experiments/issue-335/bash-web/bash-redirect-readonly.ts
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const SRC = new URL('../../../js/src', import.meta.url).pathname;
const cfg = await import(`${SRC}/config/config`);
cfg.config.permissionMode = 'readonly';
const { BashTool } = await import(`${SRC}/tool/bash`);
const { Instance } = await import(`${SRC}/project/instance`);
const { Permission } = await import(`${SRC}/permission`);

const directory = await mkdtemp(path.join(os.tmpdir(), 'expC-redir-'));
console.log('bashEnforced:', Permission.bashEnforced());
console.log(
  'string evaluator (evaluateBash) on same command:',
  Permission.evaluateBash('echo pwned > written.txt', Permission.policy().bash).action
);

for (const command of [
  'rm -f nothing',
  'echo pwned > written.txt',
  'cat /etc/hostname >> appended.txt',
]) {
  try {
    await Instance.provide({
      directory,
      fn: async () => {
        const tool = await BashTool.init();
        return tool.execute(
          { command, description: 'exp' },
          {
            sessionID: 's',
            messageID: 'm',
            agent: 'build',
            abort: new AbortController().signal,
            metadata() {},
          }
        );
      },
    });
    console.log(`ALLOWED : ${command}`);
  } catch (e) {
    console.log(`BLOCKED : ${command} -> ${String(e).slice(0, 80)}`);
  }
}
console.log('files written in readonly mode:', await readdir(directory));
await Instance.disposeAll();
await rm(directory, { recursive: true, force: true });
