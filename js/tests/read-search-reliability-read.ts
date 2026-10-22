import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Instance } from '../src/project/instance.ts';
import { ReadTool } from '../src/tool/read.ts';

/**
 * Read tool reliability fixes ported from upstream OpenCode (issue #335).
 *
 * Every test reproduces a defect the fork's read tool had before the sync:
 * - relative paths resolved against the worktree, not the cwd (6cf2c3e3db)
 * - output had no byte cap and `limit` no upper bound (#14009, #51011)
 * - macOS screenshot names (U+202F) and curly quotes were not found
 *   (#45807, #50953)
 * - a directory or a missing parent gave confusing errors (#33255/#33260)
 * - CRLF files reported an extra line and leaked `\r` (#14009, #51011)
 * - an offset past EOF returned an empty body (#14009)
 */

const ctx = {
  sessionID: 'ses_read_reliability',
  messageID: 'msg_read_reliability',
  callID: 'call_read_reliability',
  agent: 'agent',
  abort: new AbortController().signal,
  metadata() {},
};

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'agent-read-reliability-'));
}

async function read(directory: string, params: any) {
  return await Instance.provide({
    directory,
    fn: async () => {
      const tool = await ReadTool.init();
      return await tool.execute(params, ctx as any);
    },
  });
}

afterEach(async () => {
  await Instance.disposeAll();
});

describe('read tool: path resolution', () => {
  test('relative paths resolve against the current directory, not the worktree', async () => {
    const root = tempDir();
    Bun.spawnSync(['git', 'init', '-q', root]);
    const sub = join(root, 'sub');
    mkdirSync(sub);
    writeFileSync(join(root, 'a.txt'), 'root file\n');
    writeFileSync(join(sub, 'a.txt'), 'sub file\n');
    const result = await read(sub, { filePath: 'a.txt' });
    expect(result.output).toContain('sub file');
    expect(result.output).not.toContain('root file');
  });

  test('a name with U+202F matches a request typed with a plain space', async () => {
    const dir = tempDir();
    // macOS screenshots: "Screenshot 2026-01-01 at 10.00.00 AM.png"
    writeFileSync(join(dir, 'shot at 10 AM.txt'), 'narrow space\n');
    const result = await read(dir, {
      filePath: join(dir, 'shot at 10 AM.txt'),
    });
    expect(result.output).toContain('narrow space');
  });

  test('a name with a curly apostrophe matches a straight quote', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'it’s.txt'), 'curly quote\n');
    const result = await read(dir, { filePath: join(dir, "it's.txt") });
    expect(result.output).toContain('curly quote');
  });

  test('reading a directory explains that it is a directory', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'folder'));
    await expect(read(dir, { filePath: join(dir, 'folder') })).rejects.toThrow(
      /Path is a directory, not a file/
    );
  });

  test('a missing parent directory reports "File not found"', async () => {
    const dir = tempDir();
    await expect(
      read(dir, { filePath: join(dir, 'missing', 'a.txt') })
    ).rejects.toThrow(/^File not found: /);
  });
});

describe('read tool: images', () => {
  test('PNG is still treated as an image', async () => {
    const dir = tempDir();
    const file = join(dir, 'pic.png');
    writeFileSync(
      file,
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
    );
    // No model in ctx: the image path refuses instead of reading text.
    await expect(read(dir, { filePath: file })).rejects.toThrow(
      /Failed to read image/
    );
  });
});

describe('read tool: output size', () => {
  test('output is capped at 50 KB with a hint to continue', async () => {
    const dir = tempDir();
    const file = join(dir, 'wide.txt');
    writeFileSync(
      file,
      Array.from({ length: 2000 }, (_, i) => `${i}`.padEnd(5000, 'x')).join(
        '\n'
      )
    );
    const result = await read(dir, { filePath: file });
    expect(result.output.length).toBeLessThan(60_000);
    expect(result.output).toMatch(
      /\(Output capped at 50 KB\. Showing lines 1-\d+\. Use offset=\d+ to continue\.\)/
    );
    const [, last, next] = result.output.match(
      /Showing lines 1-(\d+)\. Use offset=(\d+)/
    )!;
    // `offset` is 0-based, so the next unread line index equals `last`.
    expect(next).toBe(last);
  });

  test('limit is clamped to 2000 lines', async () => {
    const dir = tempDir();
    const file = join(dir, 'long.txt');
    writeFileSync(
      file,
      Array.from({ length: 3000 }, (_, i) => `line ${i + 1}`).join('\n')
    );
    const result = await read(dir, { filePath: file, limit: 100000 });
    expect(result.output).toContain('02000| line 2000');
    expect(result.output).not.toContain('02001| line 2001');
    expect(result.output).toContain('beyond line 2000');
  });
});

describe('read tool: line handling', () => {
  test('CRLF files count lines correctly and do not leak \\r', async () => {
    const dir = tempDir();
    const file = join(dir, 'crlf.txt');
    writeFileSync(file, 'a\r\nb\r\n');
    const result = await read(dir, { filePath: file });
    expect(result.output).toContain('total 2 lines');
    expect(result.output).not.toContain('\r');
  });

  test('a trailing newline does not add an empty line', async () => {
    const dir = tempDir();
    const file = join(dir, 'lf.txt');
    writeFileSync(file, 'a\nb\n');
    const result = await read(dir, { filePath: file });
    expect(result.output).toContain('total 2 lines');
    expect(result.output).not.toContain('00003|');
  });

  test('an offset past the end of the file is reported', async () => {
    const dir = tempDir();
    const file = join(dir, 'short.txt');
    writeFileSync(file, 'one\ntwo\nthree\n');
    await expect(
      read(dir, { filePath: file, offset: 10, limit: 5 })
    ).rejects.toThrow('Offset 10 is out of range for this file (3 lines)');
  });

  test('reading an empty file still works', async () => {
    const dir = tempDir();
    const file = join(dir, 'empty.txt');
    writeFileSync(file, '');
    const result = await read(dir, { filePath: file, offset: 0 });
    expect(result.output).toContain('<file>');
  });
});
