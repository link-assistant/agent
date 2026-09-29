import z from 'zod';
import { $, raw } from 'command-stream';
import { Tool } from './tool';
import DESCRIPTION from './bash.txt';
import { Branding } from '../branding';
import { Log } from '../util/log';
import { Instance } from '../project/instance';
import { lazy } from '../util/lazy';
import { Language } from 'web-tree-sitter';
import { Permission } from '../permission';
import { fileURLToPath } from 'url';

const MAX_OUTPUT_LENGTH = 30_000;
const DEFAULT_TIMEOUT = 1 * 60 * 1000;
const MAX_TIMEOUT = 10 * 60 * 1000;
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
    const signal = AbortSignal.any([ctx.abort, timeoutSignal]);
    // This tool receives a shell command, so preserve its operators and quoting
    // after the permission check above.
    const command = $({
      cwd: Instance.directory,
      env: { ...process.env },
      signal,
      killSignal: 'SIGTERM',
      killGrace: 200,
      mirror: false,
      capture: true,
      stdin: 'ignore',
    })`${raw(params.command)}`;

    let output = '';

    // Initialize metadata with empty output
    ctx.metadata({
      metadata: {
        output: '',
        description: params.description,
      },
    });

    let exit: number | null = null;
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

    if (output.length > MAX_OUTPUT_LENGTH) {
      output = output.slice(0, MAX_OUTPUT_LENGTH);
      output += '\n\n(Output was truncated due to length limit)';
    }

    if (timeoutSignal.aborted) {
      output += `\n\n(Command timed out after ${timeout} ms)`;
    }

    if (ctx.abort.aborted) {
      output += '\n\n(Command was aborted)';
    }

    return {
      title: params.command,
      metadata: {
        output,
        exit,
        description: params.description,
      },
      output,
    };
  },
});
