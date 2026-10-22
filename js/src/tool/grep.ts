import z from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Tool } from './tool';
import { Ripgrep } from '../file/ripgrep';

import DESCRIPTION from './grep.txt';
import { Instance } from '../project/instance';
import {
  byteOffsetToColumnIndex,
  formatFocusedLineWindow,
} from './text-window';

const MAX_MATCHING_LINE_LENGTH = 2000;
const SEARCH_TIMEOUT_MS = 30_000;

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
    // d5738f542c #7501); `--no-messages` keeps per-file errors out of stderr
    // (upstream 4edb4fa4fa #8612); `--no-config` ignores RIPGREP_CONFIG_PATH.
    const args = [
      '--json',
      '--hidden',
      '--no-messages',
      '--no-config',
      '--glob=!**/.git/**',
      '--regexp',
      params.pattern,
    ];
    if (params.include) {
      args.push('--glob', params.include);
    }
    args.push(searchPath);

    // upstream 4d2696e027 / 3bda0ce123 (#39238): honor the tool call's abort
    // signal and do not let a huge search run forever.
    const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
    const signal = AbortSignal.any([ctx.abort, timeout]);
    signal.throwIfAborted();

    const proc = Bun.spawn([rgPath, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      signal,
    });

    // Drain both pipes concurrently: reading stdout to the end first
    // deadlocks once rg fills the stderr pipe.
    const [output, errorOutput, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    ctx.abort.throwIfAborted();
    if (timeout.aborted) {
      throw new Error(
        `Search timed out after ${SEARCH_TIMEOUT_MS / 1000} seconds. Consider using a more specific path or pattern.`
      );
    }

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
    const matches = [];

    for (const line of output.trim().split(/\r?\n/)) {
      if (!line) continue;

      const event = JSON.parse(line);
      if (event.type !== 'match') continue;

      const filePath = event.data?.path?.text;
      const lineNum = event.data?.line_number;
      const rawLineText = event.data?.lines?.text;
      const submatch = event.data?.submatches?.[0];
      if (!filePath || !lineNum || typeof rawLineText !== 'string') continue;

      const lineText = stripTrailingLineEnding(rawLineText);
      const matchStart = byteOffsetToColumnIndex(
        lineText,
        submatch?.start ?? 0
      );
      const matchEnd = byteOffsetToColumnIndex(
        lineText,
        submatch?.end ?? submatch?.start ?? 0
      );

      const file = Bun.file(filePath);
      const stats = await file.stat().catch(() => null);
      if (!stats) continue;

      matches.push({
        path: filePath,
        modTime: stats.mtime.getTime(),
        lineNum,
        lineText,
        matchStart,
        matchEnd,
      });
    }

    matches.sort((a, b) => b.modTime - a.modTime);

    const limit = 100;
    const truncated = matches.length > limit;
    const finalMatches = truncated ? matches.slice(0, limit) : matches;

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
      outputLines.push(
        `  Line ${match.lineNum}: ${formatFocusedLineWindow({
          line: match.lineText,
          lineNumber: match.lineNum,
          focusStart: match.matchStart,
          focusEnd: match.matchEnd,
          limit: MAX_MATCHING_LINE_LENGTH,
        })}`
      );
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

function stripTrailingLineEnding(line: string) {
  return line.replace(/\r?\n$/, '');
}
