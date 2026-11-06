import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Instance } from '../src/project/instance.ts';
import { GlobTool } from '../src/tool/glob.ts';
import { GrepTool } from '../src/tool/grep.ts';
import { ListTool } from '../src/tool/ls.ts';

/**
 * grep/glob/ls reliability fixes ported from upstream OpenCode (issue #335).
 *
 * Every test reproduces a defect the fork's search tools had before the sync:
 * - glob/ls hung forever once rg filled the stdout pipe after the consumer
 *   stopped at 100 results (upstream #10833, 76ee87ead8, 3bda0ce123)
 * - grep discarded all matches when any path was unreadable (rg exit 2)
 *   (upstream #8612) and gave raw rg errors for a missing path (#35337)
 * - grep skipped hidden files such as `.github/` (upstream #7501)
 * - grep could not be aborted (upstream 4d2696e027, #39238)
 * - glob on a file path reported "No such file or directory" (#38890)
 * - ripgrep followed symlinks and honored the user's RIPGREP_CONFIG_PATH
 *   (upstream #11415)
 */

const ctx = {
  sessionID: 'ses_search_reliability',
  messageID: 'msg_search_reliability',
  callID: 'call_search_reliability',
  agent: 'agent',
  abort: new AbortController().signal,
  metadata() {},
};

const dirs: string[] = [];

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-search-reliability-'));
  dirs.push(dir);
  return dir;
}

async function run(
  tool: typeof GlobTool | typeof GrepTool | typeof ListTool,
  directory: string,
  params: any,
  context: any = ctx
) {
  return await Instance.provide({
    directory,
    fn: async () => {
      const t = await (tool as any).init();
      return await t.execute(params, context);
    },
  });
}

afterEach(async () => {
  await Instance.disposeAll();
});

afterAll(() => {
  for (const dir of dirs) {
    try {
      chmodSync(join(dir, 'locked'), 0o755);
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('glob and ls on large trees', () => {
  // ~20k paths of ~60 bytes overflow the 64 KiB pipe many times over, so rg
  // blocks on write as soon as the tool stops reading after 100 results.
  let many = '';
  function manyFiles() {
    if (many) return many;
    many = tempDir();
    for (let d = 0; d < 20; d++) {
      const sub = join(many, `directory-${d}`);
      mkdirSync(sub);
      for (let i = 0; i < 1000; i++) {
        writeFileSync(join(sub, `a-reasonably-long-file-name-${i}.txt`), '');
      }
    }
    return many;
  }

  test(
    'glob returns the first 100 results without hanging',
    async () => {
      const dir = manyFiles();
      const result = await run(GlobTool, dir, { pattern: '**/*.txt' });
      expect(result.metadata.count).toBe(100);
      expect(result.metadata.truncated).toBe(true);
      expect(result.output).toContain('(Results are truncated.');
    },
    { timeout: 15_000 }
  );

  test(
    'ls returns the first 100 results without hanging',
    async () => {
      const dir = manyFiles();
      const result = await run(ListTool, dir, {});
      expect(result.metadata.count).toBe(100);
      expect(result.metadata.truncated).toBe(true);
    },
    { timeout: 15_000 }
  );
});

describe('glob path validation and ripgrep flags', () => {
  test('glob on a file path says it is not a directory', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'file.txt'), 'x');
    await expect(
      run(GlobTool, dir, { pattern: '*', path: join(dir, 'file.txt') })
    ).rejects.toThrow(/Search path is not a directory/);
  });

  test('glob does not follow symlinked directories', async () => {
    const dir = tempDir();
    const outside = tempDir();
    writeFileSync(join(outside, 'outside.txt'), 'x');
    writeFileSync(join(dir, 'inside.txt'), 'x');
    symlinkSync(outside, join(dir, 'link'));
    const result = await run(GlobTool, dir, { pattern: '**/*.txt' });
    expect(result.output).toContain('inside.txt');
    expect(result.output).not.toContain('outside.txt');
  });

  test('ripgrep ignores the user ripgrep config file', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'kept.txt'), 'x');
    const config = join(tempDir(), 'ripgreprc');
    // A user config with `--max-depth=0` made rg list nothing at all.
    writeFileSync(config, '--max-depth=0\n');
    // Bun.spawn uses the environment from process start, so the config has
    // to be set on a child process.
    const proc = Bun.spawn(
      [
        process.execPath,
        '-e',
        `import { Ripgrep } from './src/file/ripgrep.ts';
         const out = [];
         for await (const f of Ripgrep.files({ cwd: ${JSON.stringify(dir)} })) out.push(f);
         console.log(JSON.stringify(out));`,
      ],
      {
        cwd: join(import.meta.dir, '..'),
        env: { ...process.env, RIPGREP_CONFIG_PATH: config },
        stdout: 'pipe',
        stderr: 'pipe',
      }
    );
    const output = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    expect(JSON.parse(output)).toEqual(['kept.txt']);
  });
});

describe('grep', () => {
  // chmod 000 makes a directory unreadable only for a non-root POSIX user;
  // Windows ignores the permission bits, so rg can still read it there.
  const canLockDir = process.platform !== 'win32' && process.getuid?.() !== 0;

  test.skipIf(!canLockDir)(
    'keeps matches when some paths are unreadable (rg exit 2)',
    async () => {
      const dir = tempDir();
      writeFileSync(join(dir, 'ok.txt'), 'needle here\n');
      mkdirSync(join(dir, 'locked'));
      writeFileSync(join(dir, 'locked', 'secret.txt'), 'needle\n');
      chmodSync(join(dir, 'locked'), 0o000);
      try {
        const result = await run(GrepTool, dir, { pattern: 'needle' });
        expect(result.output).toContain('Found 1 matches');
        expect(result.output).toContain('ok.txt');
        expect(result.output).toContain(
          '(Some paths were inaccessible and skipped)'
        );
      } finally {
        chmodSync(join(dir, 'locked'), 0o755);
      }
    }
  );

  test('an invalid regex is reported as such', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'a.txt'), 'foo(\n');
    await expect(run(GrepTool, dir, { pattern: 'foo(' })).rejects.toThrow(
      /Invalid regex pattern/
    );
  });

  test('a missing search path is reported', async () => {
    const dir = tempDir();
    await expect(
      run(GrepTool, dir, { pattern: 'x', path: join(dir, 'missing') })
    ).rejects.toThrow(/Search path does not exist/);
  });

  test('a relative search path resolves against the current directory', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'a.txt'), 'relative-needle-7f3a\n');
    const result = await run(GrepTool, dir, {
      pattern: 'relative-needle-7f3a',
      path: 'src',
    });
    expect(result.output).toContain(join(dir, 'src', 'a.txt'));
  });

  test('searches hidden files such as .github/', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, '.github'));
    writeFileSync(join(dir, '.github', 'ci.yml'), 'needle: true\n');
    const result = await run(GrepTool, dir, { pattern: 'needle' });
    expect(result.output).toContain('ci.yml');
  });

  test('does not search inside .git', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, '.git'));
    writeFileSync(join(dir, '.git', 'config'), 'needle\n');
    const result = await run(GrepTool, dir, { pattern: 'needle' });
    expect(result.output).toBe('No files found');
  });

  test('an aborted call stops the search', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'a.txt'), 'needle\n');
    await expect(
      run(
        GrepTool,
        dir,
        { pattern: 'needle' },
        { ...ctx, abort: AbortSignal.abort() }
      )
    ).rejects.toThrow();
  });
});
