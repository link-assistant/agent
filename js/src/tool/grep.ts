import z from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Tool } from './tool';
import { Ripgrep } from '../file/ripgrep';

import DESCRIPTION from './grep.txt';
import { Instance } from '../project/instance';
import { config } from '../config/config';
import {
  byteOffsetToColumnIndex,
  formatFocusedLineWindow,
} from './text-window';

const MAX_MATCHING_LINE_LENGTH = 2000;
const RESULT_LIMIT = 100;
// rg output is parsed while it streams in, so memory is bounded by the
// matches kept, not by rg's total output. Past this many matches rg is
// stopped and the newest RESULT_LIMIT of the collected ones are returned.
const MAX_COLLECTED_MATCHES = 10_000;

export const GrepTool = Tool.define('grep', {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z
      .string()
      .describe('The regex pattern to search for in file contents'),
    path: z
      .string()
      .optional()
      .describe(
        'The directory to search in. Defaults to the current working directory.'
      ),
    include: z
      .string()
      .optional()
      .describe(
        'File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")'
      ),
  }),
  async execute(params, ctx) {
    if (!params.pattern) {
      throw new Error('pattern is required');
    }

    // Relative paths are relative to the session directory, not to the
    // process cwd that rg would otherwise use.
    const searchPath = path.resolve(Instance.directory, params.path || '.');
    // upstream 8f4b62eb49 (#35337): say so instead of passing rg's exit 2 on
    if (!(await fs.stat(searchPath).catch(() => undefined))) {
      throw new Error(`Search path does not exist: ${searchPath}`);
    }

    const rgPath = await Ripgrep.filepath();
    // `--hidden` finds dotfiles such as `.github/` like glob/ls do (upstream
    // d5738f542c #7501); --no-grep-hidden restores the previous behaviour.
    // `--no-messages` keeps per-file errors out of stderr (upstream
    // 4edb4fa4fa #8612); `--no-config` ignores RIPGREP_CONFIG_PATH.
    const args = ['--json'];
    if (config.grepHidden) args.push('--hidden');
    args.push('--no-messages', '--no-config');
    if (config.grepHidden) args.push('--glob=!**/.git/**');
    args.push('--regexp', params.pattern);
    if (params.include) {
      args.push('--glob', params.include);
    }
    args.push(searchPath);

    // upstream 4d2696e027 / 3bda0ce123 (#39238): honor the tool call's abort
    // signal and do not let a huge search run forever
    // (--grep-timeout-ms, 0 = no timeout).
    ctx.abort.throwIfAborted();
    const timeoutMs = config.grepTimeoutMs;
    // rg gets its own controller: a listener on the long-lived ctx.abort
    // would keep the process object reachable after the call returns.
    const stop = new AbortController();
    let timedOut = false;
    const onAbort = () => stop.abort();
    ctx.abort.addEventListener('abort', onAbort, { once: true });
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            stop.abort();
          }, timeoutMs)
        : undefined;

    const proc = Bun.spawn([rgPath, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      signal: stop.signal,
    });

    const matches: Match[] = [];
    let collectedAll = true;
    let exitCode: number;
    let errorOutput: string;
    try {
      // Drain both pipes concurrently: reading stdout to the end first
      // deadlocks once rg fills the stderr pipe.
      const stderr = new Response(proc.stderr).text();
      const mtimes = new Map<string, number | null>();
      for await (const line of lines(proc.stdout)) {
        const match = await parseMatch(line, mtimes);
        if (!match) continue;
        matches.push(match);
        if (matches.length >= MAX_COLLECTED_MATCHES) {
          collectedAll = false;
          proc.kill();
          break;
        }
      }
      [errorOutput, exitCode] = await Promise.all([stderr, proc.exited]);
    } finally {
      if (timer) clearTimeout(timer);
      ctx.abort.removeEventListener('abort', onAbort);
      // A parse error must not leave rg running.
      if (proc.exitCode === null) proc.kill();
    }

    ctx.abort.throwIfAborted();
    if (timedOut) {
      throw new Error(
        `Search timed out after ${timeoutMs / 1000} seconds. Consider using a more specific path or pattern.`
      );
    }
    // rg was stopped on purpose after enough matches.
    if (!collectedAll) exitCode = 0;

    if (exitCode === 1) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false },
        output: 'No files found',
      };
    }

    // Exit codes: 0 = matches, 1 = no matches, 2 = an error occurred. With
    // `--no-messages`, exit 2 without a regex error means some paths could
    // not be read; the matches from readable files are still valid.
    if (
      exitCode === 2 &&
      /regex parse error|error parsing regex/i.test(errorOutput)
    ) {
      throw new Error(`Invalid regex pattern: ${errorOutput.trim()}`);
    }

    if (exitCode !== 0 && exitCode !== 2) {
      throw new Error(`Exit code ${exitCode}\nripgrep failed: ${errorOutput}`);
    }

    const hasErrors = exitCode === 2;

    matches.sort((a, b) => b.modTime - a.modTime);

    const limit = RESULT_LIMIT;
    const truncated = matches.length > limit || !collectedAll;
    const finalMatches = matches.length > limit ? matches.slice(0, limit) : matches;

    if (finalMatches.length === 0) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false },
        output: hasErrors
          ? 'No files found\n\n(Some paths were inaccessible and skipped)'
          : 'No files found',
      };
    }

    const outputLines = [`Found ${finalMatches.length} matches`];

    let currentFile = '';
    for (const match of finalMatches) {
      if (currentFile !== match.path) {
        if (currentFile !== '') {
          outputLines.push('');
        }
        currentFile = match.path;
        outputLines.push(`${match.path}:`);
      }
      outputLines.push(`  Line ${match.lineNum}: ${match.text}`);
    }

    if (truncated) {
      outputLines.push('');
      outputLines.push(
        '(Results are truncated. Consider using a more specific path or pattern.)'
      );
    }

    if (hasErrors) {
      outputLines.push('');
      outputLines.push('(Some paths were inaccessible and skipped)');
    }

    return {
      title: params.pattern,
      metadata: {
        matches: finalMatches.length,
        truncated,
      },
      output: outputLines.join('\n'),
    };
  },
});

type Match = {
  path: string;
  modTime: number;
  lineNum: number;
  // Already windowed to MAX_MATCHING_LINE_LENGTH, so a minified file does not
  // keep megabyte-long lines in memory.
  text: string;
};

// Split a byte stream into lines without buffering the whole stream.
async function* lines(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  let pending = '';
  for await (const chunk of stream) {
    pending += decoder.decode(chunk, { stream: true });
    let index: number;
    while ((index = pending.indexOf('\n')) !== -1) {
      yield pending.slice(0, index).replace(/\r$/, '');
      pending = pending.slice(index + 1);
    }
  }
  pending += decoder.decode();
  if (pending) yield pending;
}

async function parseMatch(
  line: string,
  mtimes: Map<string, number | null>
): Promise<Match | undefined> {
  if (!line) return undefined;
  const event = JSON.parse(line);
  if (event.type !== 'match') return undefined;

  const filePath = event.data?.path?.text;
  const lineNum = event.data?.line_number;
  const rawLineText = event.data?.lines?.text;
  const submatch = event.data?.submatches?.[0];
  if (!filePath || !lineNum || typeof rawLineText !== 'string') return undefined;

  // One stat per file, not per matching line.
  if (!mtimes.has(filePath)) {
    const stats = await Bun.file(filePath)
      .stat()
      .catch(() => null);
    mtimes.set(filePath, stats ? stats.mtime.getTime() : null);
  }
  const modTime = mtimes.get(filePath);
  if (modTime === null || modTime === undefined) return undefined;

  const lineText = stripTrailingLineEnding(rawLineText);
  const matchStart = byteOffsetToColumnIndex(lineText, submatch?.start ?? 0);
  const matchEnd = byteOffsetToColumnIndex(
    lineText,
    submatch?.end ?? submatch?.start ?? 0
  );
  return {
    path: filePath,
    modTime,
    lineNum,
    text: formatFocusedLineWindow({
      line: lineText,
      lineNumber: lineNum,
      focusStart: matchStart,
      focusEnd: matchEnd,
      limit: MAX_MATCHING_LINE_LENGTH,
    }),
  };
}

function stripTrailingLineEnding(line: string) {
  return line.replace(/\r?\n$/, '');
}
