import z from 'zod';
import { ProcessRunner } from 'command-stream/process-runner';
import { Tool } from './tool';
import DESCRIPTION from './bash.txt';
import { Branding } from '../branding';
import { Log } from '../util/log';
import { Instance } from '../project/instance';
import { lazy } from '../util/lazy';
import { Language, type Node } from 'web-tree-sitter';
import { Permission } from '../permission';
import { fileURLToPath } from 'url';
import path from 'path';
import { processResult } from './process-result';

// Output is limited to its last MAX_LINES lines and MAX_BYTES bytes, and the
// metadata preview to its last MAX_METADATA_LENGTH characters (upstream
// 307251bf3c #22660, 754ea99d86 #39403, 2092350cfa #41007).
const MAX_BYTES = 30_000;
const MAX_LINES = 2000;
const MAX_METADATA_LENGTH = 30_000;
const DEFAULT_TIMEOUT = 1 * 60 * 1000;
const MAX_TIMEOUT = 10 * 60 * 1000;
const KILL_SIGNAL = 'SIGTERM';
export const log = Log.create({ service: 'bash-tool' });

// command-stream 1.3.0 signals only the shell on Windows, which has no process
// groups, so the shell's descendants keep running
// (link-foundation/command-stream#205). taskkill /t walks the tree from the
// shell, so it must run before the shell itself is stopped.
const killWindowsTree = async (pid: number | undefined) => {
  if (!pid) return;
  // A failed taskkill resolves with its exit code; the runner is stopped next.
  await new ProcessRunner(
    { mode: 'exec', file: 'taskkill', args: ['/pid', String(pid), '/f', '/t'] },
    { mirror: false, capture: false, stdin: 'ignore' }
  ).catch(() => {});
};

// Shells that cannot run the POSIX `-c` scripts models write
// (upstream b5d0c56b4c #3494, 238b907dd8 #5205).
const UNSUPPORTED_SHELLS = new Set(['fish', 'nu']);
const shells = new Map<string, string>();

// Resolve the shell commands run in: $SHELL when it can run them, otherwise
// zsh on macOS and bash elsewhere. Node's `shell: true` always uses /bin/sh,
// which is dash on Debian/Ubuntu. Windows keeps the platform shell.
export function selectShell(): string | undefined {
  if (process.platform === 'win32') return undefined;
  const preferred = process.env.SHELL ?? '';
  const cached = shells.get(preferred);
  if (cached) return cached;
  let shell: string | undefined;
  const name = path.basename(preferred).toLowerCase();
  if (preferred && !UNSUPPORTED_SHELLS.has(name)) {
    shell = Bun.which(preferred) ?? undefined;
  }
  shell ??=
    process.platform === 'darwin'
      ? '/bin/zsh'
      : (Bun.which('bash') ?? '/bin/sh');
  shells.set(preferred, shell);
  return shell;
}

const WRITE_REDIRECTS = new Set(['>', '>>', '>|', '&>', '&>>', '>&']);

// Output redirects that write a file. They are siblings of the command node,
// so the token scan below does not see them, and `echo x > file` would match
// an `echo*` allow rule in plan/readonly mode. Discarding output into
// /dev/null and duplicating descriptors (`2>&1`) write nothing.
// Adapted from upstream e7ff7143b6 (#6737), which has no readonly mode.
function writeRedirects(root: Node): string[] {
  const found: string[] = [];
  for (const node of root.descendantsOfType('file_redirect')) {
    if (!node) continue;
    let operator = '';
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && WRITE_REDIRECTS.has(child.type)) operator = child.type;
    }
    if (!operator) continue;
    const destination =
      node.childForFieldName('destination')?.text ?? node.lastChild?.text;
    if (destination === '/dev/null') continue;
    if (operator === '>&' && /^(\d+|-)$/.test(destination ?? '')) continue;
    found.push(node.text);
  }
  return found;
}

// Keep the end of the output, where errors are printed, cutting at line
// boundaries and never inside a UTF-8 sequence.
function tail(text: string, maxLines: number, maxBytes: number) {
  const lines = text.split('\n');
  if (lines.length <= maxLines && Buffer.byteLength(text, 'utf-8') <= maxBytes)
    return { text, cut: false };
  const out: string[] = [];
  let bytes = 0;
  for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
    const size =
      Buffer.byteLength(lines[i], 'utf-8') + (out.length > 0 ? 1 : 0);
    if (bytes + size > maxBytes) {
      if (out.length === 0) {
        const buf = Buffer.from(lines[i], 'utf-8');
        let start = Math.max(0, buf.length - maxBytes);
        while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++;
        out.unshift(buf.subarray(start).toString('utf-8'));
      }
      break;
    }
    out.unshift(lines[i]);
    bytes += size;
  }
  return { text: out.join('\n'), cut: true };
}

function preview(text: string) {
  if (text.length <= MAX_METADATA_LENGTH) return text;
  return '...\n\n' + text.slice(-MAX_METADATA_LENGTH);
}

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
      // Trees live in the WASM heap and are not garbage-collected; free each
      // one before a permission ask can wait (upstream d4bf70be06, #24861).
      try {
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
        // A `>` head matches only the catch-all pattern, so a write redirect
        // gets the mode's fallback action: deny in readonly, ask in plan.
        const redirects = writeRedirects(tree.rootNode);
        if (redirects.length > 0) commands.push(['>', ...redirects]);
      } finally {
        tree.delete();
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

    // Only the last 2 * MAX_BYTES of output are kept in memory.
    const keep = MAX_BYTES * 2;
    const chunks: { text: string; size: number }[] = [];
    let used = 0;
    let dropped = false;
    let last = '';
    // A multi-byte character can be split across chunks of one stream.
    const decoders = new Map<string, TextDecoder>();
    const append = (text: string) => {
      if (!text) return;
      const size = Buffer.byteLength(text, 'utf-8');
      chunks.push({ text, size });
      used += size;
      while (used > keep && chunks.length > 1) {
        used -= chunks.shift()!.size;
        dropped = true;
      }
      // Each update is stored and published, so send a bounded preview
      // instead of the whole output so far.
      last = preview(last + text);
      ctx.metadata({
        metadata: {
          output: last,
          description: params.description,
        },
      });
    };

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
      // On Windows the runner is stopped only after taskkill has stopped the
      // shell's process tree.
      const stop =
        process.platform === 'win32' ? new AbortController() : undefined;

      // The file/args forms run the command string in a real shell. A
      // command string spec would route simple commands and pipelines through
      // command-stream's JavaScript builtins (`ls`, `exit`, `cd`, ...) instead.
      // Windows keeps Node's platform shell (`spawn(command, { shell: true
      // })`); elsewhere the selected shell runs it with `-c`.
      const shell = selectShell();
      const command = new ProcessRunner(
        shell
          ? { mode: 'exec', file: shell, args: ['-c', params.command] }
          : { mode: 'shell', file: params.command, args: [] },
        {
          cwd: Instance.directory,
          env: { ...process.env },
          signal: stop?.signal ?? cancel,
          killSignal: KILL_SIGNAL,
          killGrace: 200,
          mirror: false,
          capture: true,
          stdin: 'ignore',
        }
      );

      const stopTree = () => {
        void killWindowsTree(command.child?.pid).finally(() => stop?.abort());
      };
      if (stop) cancel.addEventListener('abort', stopTree, { once: true });

      for await (const chunk of command.stream()) {
        if (chunk.type === 'exit') {
          exit = chunk.code;
        } else {
          let decoder = decoders.get(chunk.type);
          if (!decoder) {
            decoder = new TextDecoder();
            decoders.set(chunk.type, decoder);
          }
          append(decoder.decode(chunk.data, { stream: true }));
        }
      }
      for (const decoder of decoders.values()) append(decoder.decode());

      cancel.removeEventListener('abort', stopTree);

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

    const end = tail(
      chunks.map((item) => item.text).join(''),
      MAX_LINES,
      MAX_BYTES
    );
    let output =
      (dropped || end.cut ? '...output truncated...\n\n' : '') + end.text;

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
