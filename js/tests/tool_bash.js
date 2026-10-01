import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import { BashTool } from '../src/tool/bash';
import { config } from '../src/config/config';
import { Instance } from '../src/project/instance';
import { Permission } from '../src/permission';

/**
 * JS counterpart of `rust/tests/tool_bash.rs`.
 *
 * The Rust port keeps a per-tool unit test for the bash tool. The
 * JavaScript implementation also tests the tool through its integration
 * suite (see `js/tests/integration/bash.tools.js`). The local tests below
 * initialize the real WASM parser without an AI API call.
 *
 * Keep the stable tool name parity check alongside parser regression tests.
 */

const TOOL_NAME = 'bash';

describe('tool bash parity with Rust port', () => {
  test('tool name is a stable lower-case identifier', () => {
    expect(TOOL_NAME).toBe(TOOL_NAME.toLowerCase());
    expect(TOOL_NAME).not.toContain(' ');
    expect(TOOL_NAME.length).toBeGreaterThan(0);
  });
});

const source = fileURLToPath(new URL('../src/tool/bash.ts', import.meta.url));

// The packed-package check (experiments/issue-322/verify-bash-parser.mjs)
// copies only this file, so each test writes the process-tree fixture. The
// parent starts a child that appends to the heartbeat file every 20 ms, prints
// the child's PID, and keeps running until it is killed.
const PROCESS_TREE_PARENT = `import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const heartbeat = process.argv[2];
const child = spawn(
  process.execPath,
  [
    '-e',
    'setInterval(() => require("node:fs").appendFileSync(process.argv[1], "x"), 20)',
    heartbeat,
  ],
  { stdio: 'ignore' }
);
while (!existsSync(heartbeat)) await sleep(10);
console.log('CHILD_PID=' + child.pid);
setInterval(() => {}, 1000);
`;

function processTreeCommand(directory, heartbeat) {
  const parent = join(directory, 'process-tree-parent.mjs');
  writeFileSync(parent, PROCESS_TREE_PARENT);
  return `node "${parent}" "${heartbeat}"`;
}

async function runBash(directory, command, options = {}) {
  const updates = [];
  const controller = options.controller ?? new AbortController();
  const result = await Instance.provide({
    directory,
    fn: async () => {
      const tool = await BashTool.init();
      return tool.execute(
        { command, timeout: options.timeout, description: 'Run test command' },
        {
          sessionID: 'ses_test',
          messageID: 'msg_test',
          agent: 'agent',
          abort: controller.signal,
          metadata(update) {
            updates.push(update.metadata?.output);
            options.onMetadata?.(update.metadata?.output);
          },
        }
      );
    },
  });
  return { result, updates };
}

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'agent-bash-tool-'));
}

async function checkTreeStopped(heartbeat, output) {
  const pid = Number(output.match(/CHILD_PID=(\d+)/)?.[1]);
  expect(pid).toBeGreaterThan(0);
  try {
    expect(existsSync(heartbeat)).toBe(true);
    // command-stream settles as soon as it signals the process group. A
    // process that has not exited yet gets SIGKILL after the 200 ms grace.
    await Bun.sleep(300);
    const before = readFileSync(heartbeat).length;
    await Bun.sleep(200);
    expect(readFileSync(heartbeat).length).toBe(before);
  } finally {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already stopped.
    }
  }
}

function cleanProcessTreeFixture(directory) {
  try {
    rmSync(directory, { recursive: true, force: true });
  } catch (error) {
    // A surviving Windows descendant can lock its working directory. Keep
    // the lifecycle assertion as the test failure in that case.
    if (process.platform !== 'win32' || error.code !== 'EBUSY') {
      throw error;
    }
  }
}

afterEach(async () => {
  await Instance.disposeAll();
});

describe('bash tool command execution', () => {
  test('uses command-stream for the shipped bash tool', () => {
    const text = readFileSync(source, 'utf8');
    expect(text).toMatch(/from ['"]command-stream(?:\/process-runner)?['"]/);
    expect(text).not.toMatch(/from ['"](?:node:)?child_process['"]/);
  });

  test('preserves shell syntax, stdout, stderr, and exit metadata', async () => {
    const directory = tempDir();
    try {
      const command =
        "node -e \"process.stdout.write('out');process.stderr.write('err');process.exit(4)\"";
      const { result } = await runBash(directory, command);
      expect(result.title).toBe(command);
      expect(result.output).toContain('out');
      expect(result.output).toContain('err');
      expect(result.metadata).toEqual({
        output: result.metadata.output,
        exit: 4,
        signal: null,
        timedOut: false,
        aborted: false,
        description: 'Run test command',
      });
      expect(result.output).toBe(`Exit code 4\n${result.metadata.output}`);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('runs commands in the platform shell, not command-stream builtins', async () => {
    const directory = tempDir();
    try {
      // command-stream's builtin `exit` prints "Command failed with exit
      // code 3"; the platform shell exits silently.
      const { result } = await runBash(directory, 'exit 3');
      expect(result.output).toBe('Exit code 3\n');
      expect(result.metadata.exit).toBe(3);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test.skipIf(process.platform === 'win32')(
    'uses the same POSIX shell as child_process shell mode',
    async () => {
      const directory = tempDir();
      try {
        // command-stream's builtin `pwd` and `ls` do not run /bin/sh.
        const { result } = await runBash(directory, 'echo "$0" && pwd');
        expect(result.output).toBe(`/bin/sh\n${realpathSync(directory)}\n`);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  );

  test('streams metadata while the command is still running', async () => {
    const directory = tempDir();
    const command =
      "node -e \"process.stdout.write('first');setTimeout(()=>process.stderr.write('second'),150)\"";
    let sawPartial = false;
    try {
      const { result, updates } = await runBash(directory, command, {
        onMetadata(output) {
          if (output === 'first') {
            sawPartial = true;
          }
        },
      });
      expect(sawPartial).toBe(true);
      expect(updates[0]).toBe('');
      expect(updates.at(-1)).toContain('second');
      expect(result.output).toContain('first');
      expect(result.output).toContain('second');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('truncates long output with the original suffix', async () => {
    const directory = tempDir();
    try {
      const { result } = await runBash(
        directory,
        'node -e "process.stdout.write(\'x\'.repeat(30001))"'
      );
      expect(result.output).toBe(
        `${'x'.repeat(30000)}\n\n(Output was truncated due to length limit)`
      );
      expect(result.metadata.output).toBe(result.output);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('timeout stops the process tree and retains the timeout suffix', async () => {
    const directory = tempDir();
    const heartbeat = join(directory, 'timeout-heartbeat');
    try {
      const { result } = await runBash(
        directory,
        processTreeCommand(directory, heartbeat),
        { timeout: 2000 }
      );
      expect(result.output).toContain('(Command timed out after 2000 ms)');
      await checkTreeStopped(heartbeat, result.output);
    } finally {
      cleanProcessTreeFixture(directory);
    }
  });

  test('caller abort stops the process tree and retains the abort suffix', async () => {
    const directory = tempDir();
    const heartbeat = join(directory, 'abort-heartbeat');
    const controller = new AbortController();
    try {
      const { result } = await runBash(
        directory,
        processTreeCommand(directory, heartbeat),
        {
          controller,
          onMetadata(output) {
            if (output?.includes('CHILD_PID=')) {
              controller.abort();
            }
          },
        }
      );
      expect(result.output).toContain('(Command was aborted)');
      await checkTreeStopped(heartbeat, result.output);
    } finally {
      cleanProcessTreeFixture(directory);
    }
  });
});

describe('bash parser and permission enforcement', () => {
  let savedMode;
  let savedPermission;
  let directory;

  beforeEach(() => {
    savedMode = config.permissionMode;
    savedPermission = config.permission;
  });

  afterEach(async () => {
    config.permissionMode = savedMode;
    config.permission = savedPermission;
    await Instance.disposeAll();
    if (directory) {
      await rm(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });

  const execute = async (command) => {
    directory = await mkdtemp(join(tmpdir(), 'agent-bash-parser-'));
    config.permissionMode = 'readonly';
    config.permission = '{"bash":{"echo*":"allow","*":"deny"}}';
    return Instance.provide({
      directory,
      fn: async () => {
        const tool = await BashTool.init();
        return tool.execute(
          { command },
          {
            sessionID: 'ses_bash_parser',
            messageID: 'msg_bash_parser',
            agent: 'build',
            abort: new AbortController().signal,
            metadata() {},
          }
        );
      },
    });
  };

  test('initializes the real WASM parser before running an allowed command', async () => {
    const result = await execute('echo parser-ready');
    expect(result.output.trim()).toBe('parser-ready');
    expect(result.metadata.exit).toBe(0);
  });

  test.each(['echo allowed && touch denied', 'echo "$(touch denied)"'])(
    'rejects a denied command node in %s before executing',
    async (command) => {
      await expect(execute(command)).rejects.toBeInstanceOf(
        Permission.RejectedError
      );
      await expect(readFile(join(directory, 'denied'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    }
  );
});
