import z from 'zod';
import { ProcessRunner } from 'command-stream/process-runner';
import { Tool } from './tool';
import DESCRIPTION from './bash.txt';
import { Branding } from '../branding';
import { Log } from '../util/log';
import { Instance } from '../project/instance';
import { lazy } from '../util/lazy';
import { Language } from 'web-tree-sitter';
import { Permission } from '../permission';
import { fileURLToPath } from 'url';
import { processResult } from './process-result';

const MAX_OUTPUT_LENGTH = 30_000;
const DEFAULT_TIMEOUT = 1 * 60 * 1000;
const MAX_TIMEOUT = 10 * 60 * 1000;
const KILL_SIGNAL = 'SIGTERM';
export const log = Log.create({ service: 'bash-tool' });

const resolveWasm = (asset: string) => {
  if (asset.startsWith('file://')) return fileURLToPath(asset);
  if (asset.startsWith('/') || /^[a-z]:/i.test(asset)) return asset;
  const url = new URL(asset, import.meta.url);
  return fileURLToPath(url);
};

const parser = lazy(async () => {
  const { Parser } = await import('web-tree-sitter');
  // web-tree-sitter renamed its runtime WASM in 0.26. Resolve the current
  // export while retaining 0.25 compatibility until OpenTUI lifts its peer pin.
  let treePath: string;
  try {
    treePath = resolveWasm(
      import.meta.resolve('web-tree-sitter/web-tree-sitter.wasm')
    );
  } catch {
    treePath = resolveWasm(
      import.meta.resolve('web-tree-sitter/tree-sitter.wasm')
    );
  }
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
  description: Branding.apply(DESCRIPTION),
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

    // Permission enforcement (issue #271). In the default `auto` mode every
    // bash pattern resolves to `allow`, so we skip the tree-sitter parse
    // entirely and keep zero overhead. In plan/readonly/ask modes (or with a
    // `--permission` override) we parse the shell line into its individual
    // command nodes and evaluate each against the bash policy: a `deny` match
    // throws, `ask` matches are batched into a single JSON permission request.
    if (Permission.bashEnforced()) {
      const tree = await parser().then((p) => p.parse(params.command));
      if (!tree) {
        throw new Error('Failed to parse command');
      }
      const commands: string[][] = [];
      for (const node of tree.rootNode.descendantsOfType('command')) {
        if (!node) continue;
        const command: string[] = [];
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (!child) continue;
          if (
            child.type !== 'command_name' &&
            child.type !== 'word' &&
            child.type !== 'string' &&
            child.type !== 'raw_string' &&
            child.type !== 'concatenation'
          ) {
            continue;
          }
          command.push(child.text);
        }
        commands.push(command);
      }
      await Permission.checkBashTokens({
        commands,
        command: params.command,
        sessionID: ctx.sessionID,
        messageID: ctx.messageID,
        callID: ctx.callID,
      });
    }

    const timeoutSignal = AbortSignal.timeout(timeout);
    const cancel = AbortSignal.any([ctx.abort, timeoutSignal]);

    let output = '';

    // Initialize metadata with empty output
    ctx.metadata({
      metadata: {
        output: '',
        description: params.description,
      },
    });

    let exit: number | null = null;
    let signal: string | null = null;

    // command-stream 1.3.0 finishes a runner whose signal is already aborted
    // before stream() subscribes to its end event, so the iterator never ends
    // (link-foundation/command-stream#207).
    // A cancelled command does not need to start at all.
    if (!cancel.aborted) {
      // The file/args shell form spawns the command string through Node's
      // platform shell, as `spawn(command, { shell: true })` does. A command
      // string spec would route simple commands and pipelines through
      // command-stream's JavaScript builtins (`ls`, `exit`, `cd`, ...) instead.
      const command = new ProcessRunner(
        { mode: 'shell', file: params.command, args: [] },
        {
          cwd: Instance.directory,
          env: { ...process.env },
          signal: cancel,
          killSignal: KILL_SIGNAL,
          killGrace: 200,
          mirror: false,
          capture: true,
          stdin: 'ignore',
        }
      );

      for await (const chunk of command.stream()) {
        if (chunk.type === 'exit') {
          exit = chunk.code;
        } else {
          output += chunk.data.toString();
          ctx.metadata({
            metadata: {
              output,
              description: params.description,
            },
          });
        }
      }

      // command-stream reports a shell that died from a signal as exit 0
      // (link-foundation/command-stream#208).
      // Its result keeps the native child, which has the signal name.
      const finished = command.result as {
        child?: { signalCode?: string | null };
      } | null;
      signal = finished?.child?.signalCode ?? null;
    }

    const timedOut = timeoutSignal.aborted;
    const aborted = ctx.abort.aborted;
    // command-stream settles a cancelled command as soon as it sends the kill
    // signal and reports a synthesized 128 + signal code. The real exit status
    // is unavailable, as it is when the shell itself dies from a signal.
    if (timedOut || aborted) signal = KILL_SIGNAL;
    if (signal) exit = null;

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

    const result = processResult({
      output,
      exit,
      signal,
      timedOut,
      aborted,
    });

    log.debug(() => ({
      message: 'command finished',
      exit,
      signal,
      timedOut,
      aborted,
      isError: result.isError,
    }));

    return {
      title: params.command,
      metadata: {
        output,
        exit,
        signal,
        timedOut,
        aborted,
        description: params.description,
      },
      ...result,
    };
  },
});
