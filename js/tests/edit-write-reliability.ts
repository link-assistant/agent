import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Instance } from '../src/project/instance.ts';
import { EditTool, replace } from '../src/tool/edit.ts';
import { WriteTool } from '../src/tool/write.ts';
import { ReadTool } from '../src/tool/read.ts';
import { FileTime } from '../src/file/time.ts';

/**
 * Reliability fixes ported from upstream OpenCode (issue #335).
 *
 * Every test in this file reproduces a defect that existed in the fork's
 * edit/write tools before the sync:
 * - concurrent edits of one file silently lost updates (upstream 5cf126d489)
 * - fuzzy block-anchor matching replaced unrelated code (upstream #30932)
 * - an empty oldString overwrote an existing file (upstream #30932)
 * - CRLF files were partially converted to LF (upstream #9443 / #23483)
 * - a UTF-8 BOM was dropped by edit/write (upstream #23797)
 * - replaceAll interpreted `$&`/`$1` in newString (String#replaceAll)
 * - FileTime used wall-clock time and unnormalized keys (upstream #23483)
 * - edit after write failed because write never recorded a read
 */

const ctx = {
  sessionID: 'ses_reliability',
  messageID: 'msg_reliability',
  callID: 'call_reliability',
  agent: 'agent',
  abort: new AbortController().signal,
  metadata() {},
};

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'agent-edit-reliability-'));
}

async function inInstance<T>(directory: string, fn: () => Promise<T>) {
  return await Instance.provide({ directory, fn });
}

async function run(
  tool: typeof EditTool | typeof WriteTool | typeof ReadTool,
  params: any
) {
  const t = await (tool as any).init();
  return await t.execute(params, ctx);
}

afterEach(async () => {
  await Instance.disposeAll();
});

describe('edit tool: concurrency', () => {
  test('parallel edits on one file are serialized and none is lost', async () => {
    const dir = tempDir();
    const file = join(dir, 'parallel.txt');
    const lines = Array.from({ length: 20 }, (_, i) => `line-${i}`);
    writeFileSync(file, lines.join('\n') + '\n');
    await inInstance(dir, async () => {
      await run(ReadTool, { filePath: file });
      await Promise.all(
        lines.map((line) =>
          run(EditTool, {
            filePath: file,
            oldString: line + '\n',
            newString: line + '-edited\n',
          })
        )
      );
    });
    const result = readFileSync(file, 'utf8');
    for (const line of lines) expect(result).toContain(`${line}-edited\n`);
  });
});

describe('edit tool: destructive match guards', () => {
  test('block anchor does not match a span far larger than oldString', () => {
    const content = [
      'function a() {',
      '  one();',
      '  two();',
      '  three();',
      '  four();',
      '  five();',
      '  six();',
      '  seven();',
      '}',
    ].join('\n');
    const oldString = ['function a() {', '  totally different', '}'].join('\n');
    expect(() => replace(content, oldString, 'x')).toThrow();
  });

  test('block anchor with low similarity is rejected', () => {
    const content = ['start', 'alpha beta gamma', 'end'].join('\n');
    const oldString = ['start', 'zzzzzzzzzzzzzzzz', 'end'].join('\n');
    expect(() => replace(content, oldString, 'x')).toThrow();
  });

  test('block anchor with a close middle line still matches', () => {
    const content = ['start', '  value = compute(1, 2);', 'end'].join('\n');
    const oldString = ['start', '  value = compute(1, 3);', 'end'].join('\n');
    expect(replace(content, oldString, 'replaced')).toBe('replaced');
  });

  test('replace() rejects an empty oldString', () => {
    expect(() => replace('abc', '', 'x')).toThrow();
  });

  test('empty oldString does not overwrite an existing file', async () => {
    const dir = tempDir();
    const file = join(dir, 'keep.txt');
    writeFileSync(file, 'precious\n');
    await inInstance(dir, async () => {
      await run(ReadTool, { filePath: file });
      await expect(
        run(EditTool, { filePath: file, oldString: '', newString: 'gone' })
      ).rejects.toThrow(/oldString cannot be empty/);
    });
    expect(readFileSync(file, 'utf8')).toBe('precious\n');
  });

  test('empty oldString still creates a new file', async () => {
    const dir = tempDir();
    const file = join(dir, 'new.txt');
    await inInstance(dir, async () => {
      await run(EditTool, { filePath: file, oldString: '', newString: 'hi' });
    });
    expect(readFileSync(file, 'utf8')).toBe('hi');
  });
});

describe('edit tool: encoding preservation', () => {
  test('CRLF file stays CRLF when oldString/newString use LF', async () => {
    const dir = tempDir();
    const file = join(dir, 'crlf.txt');
    writeFileSync(file, 'a\r\nb\r\nc\r\n');
    await inInstance(dir, async () => {
      await run(ReadTool, { filePath: file });
      await run(EditTool, {
        filePath: file,
        oldString: 'a\nb',
        newString: 'a\nB\nb2',
      });
    });
    expect(readFileSync(file, 'utf8')).toBe('a\r\nB\r\nb2\r\nc\r\n');
  });

  test('LF file stays LF when oldString/newString use CRLF', async () => {
    const dir = tempDir();
    const file = join(dir, 'lf.txt');
    writeFileSync(file, 'a\nb\nc\n');
    await inInstance(dir, async () => {
      await run(ReadTool, { filePath: file });
      await run(EditTool, {
        filePath: file,
        oldString: 'a\r\nb',
        newString: 'x\r\ny',
      });
    });
    expect(readFileSync(file, 'utf8')).toBe('x\ny\nc\n');
  });

  test('mixed file uses its dominant line ending for new lines', async () => {
    const dir = tempDir();
    const file = join(dir, 'mixed-endings.txt');
    // Mostly LF with one stray CRLF line (upstream #53166).
    writeFileSync(file, 'a\nb\nc\r\nd\ne\n');
    await inInstance(dir, async () => {
      await run(ReadTool, { filePath: file });
      await run(EditTool, {
        filePath: file,
        oldString: 'd\ne',
        newString: 'd\nd2\ne',
      });
    });
    expect(readFileSync(file, 'utf8')).toBe('a\nb\nc\r\nd\nd2\ne\n');
  });

  test('UTF-8 BOM is preserved by edit', async () => {
    const dir = tempDir();
    const file = join(dir, 'bom.txt');
    writeFileSync(file, '﻿hello world\n');
    await inInstance(dir, async () => {
      await run(ReadTool, { filePath: file });
      await run(EditTool, {
        filePath: file,
        oldString: 'hello',
        newString: 'goodbye',
      });
    });
    const bytes = readFileSync(file);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.subarray(3).toString('utf8')).toBe('goodbye world\n');
  });

  test('UTF-8 BOM is preserved by write when overwriting', async () => {
    const dir = tempDir();
    const file = join(dir, 'bom-write.txt');
    writeFileSync(file, '﻿old\n');
    await inInstance(dir, async () => {
      await run(WriteTool, { filePath: file, content: 'new\n' });
    });
    const bytes = readFileSync(file);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.subarray(3).toString('utf8')).toBe('new\n');
  });

  test('write does not duplicate a BOM supplied in content', async () => {
    const dir = tempDir();
    const file = join(dir, 'bom-write-2.txt');
    writeFileSync(file, '﻿old\n');
    await inInstance(dir, async () => {
      await run(WriteTool, { filePath: file, content: '﻿new\n' });
    });
    const bytes = readFileSync(file);
    expect([...bytes.subarray(0, 6)]).not.toEqual([
      0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf,
    ]);
    expect(bytes.subarray(3).toString('utf8')).toBe('new\n');
  });
});

describe('edit tool: replaceAll', () => {
  test('replaceAll inserts `$` patterns literally', () => {
    expect(replace('a a a', 'a', '$&$&', true)).toBe('$&$& $&$& $&$&');
    expect(replace('price', 'price', "$'", true)).toBe("$'");
  });

  test('single replacement inserts `$` patterns literally', () => {
    expect(replace('x = 1', '1', '$1')).toBe('x = $1');
  });
});

describe('FileTime stamps', () => {
  test('a file with a future mtime can be edited after reading it', async () => {
    const dir = tempDir();
    const file = join(dir, 'future.txt');
    writeFileSync(file, 'one\n');
    const future = new Date(Date.now() + 60 * 60 * 1000);
    utimesSync(file, future, future);
    await inInstance(dir, async () => {
      await run(ReadTool, { filePath: file });
      await run(EditTool, {
        filePath: file,
        oldString: 'one',
        newString: 'two',
      });
    });
    expect(readFileSync(file, 'utf8')).toBe('two\n');
  });

  test('read and edit agree on equivalent paths', async () => {
    const dir = tempDir();
    const file = join(dir, 'same.txt');
    writeFileSync(file, 'one\n');
    await inInstance(dir, async () => {
      await run(ReadTool, { filePath: dir + '/./same.txt' });
      await run(EditTool, {
        filePath: file,
        oldString: 'one',
        newString: 'two',
      });
    });
    expect(readFileSync(file, 'utf8')).toBe('two\n');
  });

  test('external modification after read is still detected', async () => {
    const dir = tempDir();
    const file = join(dir, 'external.txt');
    writeFileSync(file, 'one\n');
    await inInstance(dir, async () => {
      await run(ReadTool, { filePath: file });
      writeFileSync(file, 'one changed elsewhere\n');
      const past = new Date(Date.now() - 60 * 60 * 1000);
      utimesSync(file, past, past);
      await expect(
        run(EditTool, { filePath: file, oldString: 'one', newString: 'two' })
      ).rejects.toThrow(/modified since it was last read/);
    });
  });

  test('withLock serializes callbacks for the same file', async () => {
    const dir = tempDir();
    const order: string[] = [];
    await inInstance(dir, async () => {
      const file = join(dir, 'lock.txt');
      await Promise.all([
        FileTime.withLock(file, async () => {
          order.push('a-start');
          await Bun.sleep(20);
          order.push('a-end');
        }),
        FileTime.withLock(join(dir, '.', 'lock.txt'), async () => {
          order.push('b-start');
          order.push('b-end');
        }),
      ]);
    });
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });
});

describe('write tool', () => {
  test('edit right after write works without a separate read', async () => {
    const dir = tempDir();
    const file = join(dir, 'written.txt');
    await inInstance(dir, async () => {
      await run(WriteTool, { filePath: file, content: 'alpha\n' });
      await run(EditTool, {
        filePath: file,
        oldString: 'alpha',
        newString: 'beta',
      });
    });
    expect(readFileSync(file, 'utf8')).toBe('beta\n');
  });

  test('write and edit return a non-empty confirmation', async () => {
    const dir = tempDir();
    const file = join(dir, 'confirm.txt');
    await inInstance(dir, async () => {
      const w = await run(WriteTool, { filePath: file, content: 'alpha\n' });
      expect(w.output).toBe('Wrote file successfully.');
      const e = await run(EditTool, {
        filePath: file,
        oldString: 'alpha',
        newString: 'beta',
      });
      expect(e.output).toBe('Edit applied successfully.');
    });
  });

  test('parallel writes and edits to one file do not interleave', async () => {
    const dir = tempDir();
    const file = join(dir, 'mixed.txt');
    await inInstance(dir, async () => {
      await run(WriteTool, { filePath: file, content: 'k0\n' });
      await run(EditTool, {
        filePath: file,
        oldString: 'k0',
        newString: 'k1',
      });
      const results = await Promise.allSettled([
        run(EditTool, { filePath: file, oldString: 'k1', newString: 'k2' }),
        run(EditTool, { filePath: file, oldString: 'k1', newString: 'k3' }),
      ]);
      // Exactly one edit can apply; the other must fail loudly instead of
      // silently overwriting the first edit's result.
      expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
    });
    expect(['k2\n', 'k3\n']).toContain(readFileSync(file, 'utf8'));
  });
});
