import z from 'zod';
import { spawn } from 'child_process';
import { Tool } from './tool';
import DESCRIPTION from './bash.txt';
import { Log } from '../util/log';
import { Instance } from '../project/instance';
import { lazy } from '../util/lazy';
import { Language } from 'web-tree-sitter';
import { $ } from 'bun';
import { Filesystem } from '../util/filesystem';
import { fileURLToPath } from 'url';

const MAX_OUTPUT_LENGTH = 30_000;
const DEFAULT_TIMEOUT = 1 * 60 * 1000;
const MAX_TIMEOUT = 10 * 60 * 1000;
const SIGKILL_TIMEOUT_MS = 200;

export const log = Log.create({ service: 'bash-tool' });

const resolveWasm = (asset: string) => {
  if (asset.startsWith('file://')) return fileURLToPath(asset);
  if (asset.startsWith('/') || /^[a-z]:/i.test(asset)) return asset;
  const url = new URL(asset, import.meta.url);
  return fileURLToPath(url);
};

const parser = lazy(async () => {
  const { Parser } = await import('web-tree-sitter');
  const { default: treeWasm } = await import(
    'web-tree-sitter/tree-sitter.wasm' as string,
    {
      with: { type: 'wasm' },
    }
  );
  const treePath = resolveWasm(treeWasm);
  await Parser.init({
    locateFile() {
      return treePath;
    },
  });
  const { default: bashWasm } = await import(
    'tree-sitter-bash/tree-sitter-bash.wasm' as string,
    {
      with: { type: 'wasm' },
    }
  );
  const bashPath = resolveWasm(bashWasm);
  const bashLanguage = await Language.load(bashPath);
  const p = new Parser();
  p.setLanguage(bashLanguage);
  return p;
});

export const BashTool = Tool.define('bash', {
  description: DESCRIPTION,
  parameters: z.object({
    command: z.string().describe('The command to execute'),
    timeout: z.number().describe('Optional timeout in milliseconds').optional(),
    description: z
      .string()
      .describe(
        "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'"
      )
      .optional(),
  }),
  async execute(params, ctx) {
    if (params.timeout !== undefined && params.timeout < 0) {
      throw new Error(
        `Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`
      );
    }
    const timeout = Math.min(params.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);

    // No restrictions - unrestricted command execution
    const proc = spawn(params.command, {
      shell: true,
      cwd: Instance.directory,
      env: {
        ...process.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });

    let output = '';

    // Initialize metadata with empty output
    ctx.metadata({
      metadata: {
        output: '',
        description: params.description,
      },
    });

    const append = (chunk: Buffer) => {
      output += chunk.toString();
      ctx.metadata({
        metadata: {
          output,
          description: params.description,
        },
      });
    };

    proc.stdout?.on('data', append);
    proc.stderr?.on('data', append);

    let timedOut = false;
    let aborted = false;
    let exited = false;

    const killTree = async () => {
      const pid = proc.pid;
      if (!pid || exited) {
        return;
      }

      if (process.platform === 'win32') {
        await new Promise<void>((resolve) => {
          const killer = spawn('taskkill', ['/pid', String(pid), '/f', '/t'], {
            stdio: 'ignore',
          });
          killer.once('exit', resolve);
          killer.once('error', resolve);
        });
        return;
      }

      try {
        process.kill(-pid, 'SIGTERM');
        await Bun.sleep(SIGKILL_TIMEOUT_MS);
        if (!exited) {
          process.kill(-pid, 'SIGKILL');
        }
      } catch (_e) {
        proc.kill('SIGTERM');
        await Bun.sleep(SIGKILL_TIMEOUT_MS);
        if (!exited) {
          proc.kill('SIGKILL');
        }
      }
    };

    if (ctx.abort.aborted) {
      aborted = true;
      await killTree();
    }

    const abortHandler = () => {
      aborted = true;
      void killTree();
    };

    ctx.abort.addEventListener('abort', abortHandler, { once: true });

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      void killTree();
    }, timeout);

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeoutTimer);
        ctx.abort.removeEventListener('abort', abortHandler);
      };

      proc.once('exit', () => {
        exited = true;
        cleanup();
        resolve();
      });

      proc.once('error', (error) => {
        exited = true;
        cleanup();
        reject(error);
      });
    });

    if (output.length > MAX_OUTPUT_LENGTH) {
      output = output.slice(0, MAX_OUTPUT_LENGTH);
      output += '\n\n(Output was truncated due to length limit)';
    }

    if (timedOut) {
      output += `\n\n(Command timed out after ${timeout} ms)`;
    }

    if (aborted) {
      output += '\n\n(Command was aborted)';
    }

    return {
      title: params.command,
      metadata: {
        output,
        exit: proc.exitCode,
        description: params.description,
      },
      output,
    };
  },
});
