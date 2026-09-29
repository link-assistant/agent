import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { URL, fileURLToPath } from 'url';
import { Instance } from '../src/project/instance.ts';
import { BashTool } from '../src/tool/bash.ts';

const source = fileURLToPath(new URL('../src/tool/bash.ts', import.meta.url));
const parent = fileURLToPath(
  new URL(
    '../../experiments/issue-320/process-tree-parent.mjs',
    import.meta.url
  )
);

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

afterEach(async () => {
  await Instance.disposeAll();
});

describe('bash tool command execution', () => {
  test('uses command-stream for the shipped bash tool', () => {
    const text = readFileSync(source, 'utf8');
    expect(text).toMatch(/from ['"]command-stream['"]/);
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
        output: result.output,
        exit: 4,
        description: 'Run test command',
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

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
        `node "${parent}" "${heartbeat}"`,
        { timeout: 600 }
      );
      expect(result.output).toContain('(Command timed out after 600 ms)');
      await checkTreeStopped(heartbeat, result.output);
    } finally {
      rmSync(directory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    }
  });

  test('caller abort stops the process tree and retains the abort suffix', async () => {
    const directory = tempDir();
    const heartbeat = join(directory, 'abort-heartbeat');
    const controller = new AbortController();
    try {
      const { result } = await runBash(
        directory,
        `node "${parent}" "${heartbeat}"`,
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
      rmSync(directory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    }
  });
});
