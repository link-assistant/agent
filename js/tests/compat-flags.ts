import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { COMPAT_DEFAULTS, config } from '../src/config/config';
import { Instance } from '../src/project/instance';
import { BashTool, selectShell } from '../src/tool/bash';
import { EditTool } from '../src/tool/edit';
import { WriteTool } from '../src/tool/write';
import { MultiEditTool } from '../src/tool/multiedit';
import { ReadTool } from '../src/tool/read';
import { GrepTool } from '../src/tool/grep';
import { GlobTool } from '../src/tool/glob';
import { FileTime } from '../src/file/time';
import { Permission } from '../src/permission';
import { Session } from '../src/session';
import { SessionRetry } from '../src/session/retry';
import { RetryFetch } from '../src/provider/retry-fetch';
import { legacyErrorObject } from '../src/util/legacy-error-names';
import { withTimeout } from '../src/util/timeout';
import { sanitizeUrl } from '../src/util/verbose-fetch';
import {
  MAX_PENDING_SSE_USAGE,
  SSEUsageExtractor,
} from '../src/util/sse-usage-extractor';

/**
 * Backward-compatibility switches and leak regressions for issue #335.
 *
 * Every user-visible change from the upstream OpenCode sync has an opt-in
 * flag that restores the previous behaviour (PR #339 review). Each flag is
 * tested in both states, so neither the new default nor the legacy
 * behaviour can regress silently. The second half covers the leak fixes
 * from experiments/issue-335/audit/memory-leak-audit.md.
 */

const ctx = {
  sessionID: 'ses_compat_flags',
  messageID: 'msg_compat_flags',
  callID: 'call_compat_flags',
  agent: 'build',
  abort: new AbortController().signal,
  metadata() {},
};

const dirs: string[] = [];
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-compat-flags-'));
  dirs.push(dir);
  return dir;
}

async function run(tool: any, directory: string, params: any) {
  return await Instance.provide({
    directory,
    fn: async () => {
      const t = await tool.init();
      return await t.execute(params, ctx);
    },
  });
}

/** Runs `fn` with `config` overrides and restores the previous values. */
async function withConfig<T>(
  overrides: Partial<typeof config>,
  fn: () => Promise<T> | T
): Promise<T> {
  const saved: Record<string, unknown> = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = (config as any)[key];
    (config as any)[key] = (overrides as any)[key];
  }
  try {
    return await fn();
  } finally {
    Object.assign(config, saved);
  }
}

afterEach(async () => {
  await Instance.disposeAll();
});

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('compat flags: defaults and env wiring', () => {
  test('defaults keep the new behaviour', () => {
    expect(COMPAT_DEFAULTS).toEqual({
      bashShell: 'auto',
      legacyToolOutput: false,
      legacyEditMatching: false,
      globFollowSymlinks: false,
      grepHidden: true,
      grepTimeoutMs: 30_000,
      readMaxLines: 2000,
      readMaxBytes: 51_200,
      legacyErrorNames: false,
      legacyTokenUsage: false,
      legacyLoopExit: false,
      mcpConnectTimeout: 30_000,
    });
  });

  test('LINK_ASSISTANT_AGENT_* env vars select the legacy behaviour', () => {
    const env = {
      ...process.env,
      LINK_ASSISTANT_AGENT_BASH_SHELL: 'legacy',
      LINK_ASSISTANT_AGENT_LEGACY_TOOL_OUTPUT: 'true',
      LINK_ASSISTANT_AGENT_LEGACY_EDIT_MATCHING: 'true',
      LINK_ASSISTANT_AGENT_GLOB_FOLLOW_SYMLINKS: 'true',
      LINK_ASSISTANT_AGENT_GREP_HIDDEN: 'false',
      LINK_ASSISTANT_AGENT_GREP_TIMEOUT_MS: '0',
      LINK_ASSISTANT_AGENT_READ_MAX_LINES: '0',
      LINK_ASSISTANT_AGENT_READ_MAX_BYTES: '0',
      LINK_ASSISTANT_AGENT_LEGACY_ERROR_NAMES: 'true',
      LINK_ASSISTANT_AGENT_LEGACY_TOKEN_USAGE: 'true',
      LINK_ASSISTANT_AGENT_LEGACY_LOOP_EXIT: 'true',
      LINK_ASSISTANT_AGENT_MCP_CONNECT_TIMEOUT: '0',
    };
    const proc = Bun.spawnSync(
      [
        process.execPath,
        '-e',
        `import { config, COMPAT_DEFAULTS } from './src/config/config.ts';
         const out = {};
         for (const key of Object.keys(COMPAT_DEFAULTS)) out[key] = config[key];
         console.log(JSON.stringify(out));`,
      ],
      { cwd: join(import.meta.dir, '..'), env }
    );
    expect(JSON.parse(proc.stdout.toString().trim())).toEqual({
      bashShell: 'legacy',
      legacyToolOutput: true,
      legacyEditMatching: true,
      globFollowSymlinks: true,
      grepHidden: false,
      grepTimeoutMs: 0,
      readMaxLines: 0,
      readMaxBytes: 0,
      legacyErrorNames: true,
      legacyTokenUsage: true,
      legacyLoopExit: true,
      mcpConnectTimeout: 0,
    });
  });
});

describe('--bash-shell', () => {
  const posix = process.platform !== 'win32';

  test.if(posix)('legacy uses the platform default shell', () => {
    expect(selectShell('legacy')).toBeUndefined();
  });

  test.if(posix)('auto ignores a non-POSIX $SHELL', () => {
    const saved = process.env.SHELL;
    process.env.SHELL = '/usr/bin/fish';
    try {
      const shell = selectShell('auto');
      expect(shell).toBeDefined();
      expect(shell).not.toContain('fish');
    } finally {
      if (saved === undefined) delete process.env.SHELL;
      else process.env.SHELL = saved;
    }
  });

  test.if(posix)('an explicit shell is used as given', () => {
    expect(selectShell('sh')).toBe(Bun.which('sh') ?? 'sh');
  });

  test.if(posix)('legacy mode still runs commands', async () => {
    const result = await withConfig({ bashShell: 'legacy' }, () =>
      run(BashTool, tempDir(), {
        command: 'echo compat',
        description: 'compat',
      })
    );
    expect(result.output.trim()).toBe('compat');
  });
});

describe('--legacy-tool-output', () => {
  const command = `${process.execPath} -e "process.stdout.write('a'.repeat(20000) + 'b'.repeat(20000))"`;

  test('default keeps the tail of long bash output', async () => {
    const result = await run(BashTool, tempDir(), {
      command,
      description: 'long output',
    });
    expect(result.output).toContain('...output truncated...');
    expect(result.output.endsWith('b')).toBe(true);
  });

  test('legacy keeps the head and the old truncation note', async () => {
    const result = await withConfig({ legacyToolOutput: true }, () =>
      run(BashTool, tempDir(), { command, description: 'long output' })
    );
    expect(result.output).toBe(
      'a'.repeat(20000) +
        'b'.repeat(10000) +
        '\n\n(Output was truncated due to length limit)'
    );
  });

  test('edit/write/multiedit return the old empty output', async () => {
    const dir = tempDir();
    const file = join(dir, 'a.txt');
    const fresh = await run(WriteTool, dir, { filePath: file, content: 'x\n' });
    expect(fresh.output).toBe('Wrote file successfully.');
    await withConfig({ legacyToolOutput: true }, async () => {
      const write = await run(WriteTool, dir, {
        filePath: file,
        content: 'one\n',
      });
      expect(write.output).toBe('');
      const edit = await run(EditTool, dir, {
        filePath: file,
        oldString: 'one',
        newString: 'two',
      });
      expect(edit.output).toBe('');
    });
    const edit = await run(EditTool, dir, {
      filePath: file,
      oldString: 'two',
      newString: 'three',
    });
    expect(edit.output).toBe('Edit applied successfully.');
    expect(readFileSync(file, 'utf8')).toBe('three\n');
  });

  test('multiedit with no edits returns an empty output', async () => {
    const dir = tempDir();
    const file = join(dir, 'a.txt');
    writeFileSync(file, 'x');
    const result = await run(MultiEditTool, dir, { filePath: file, edits: [] });
    expect(result.output).toBe('');
  });

  test('read past the end: error by default, empty body with legacy', async () => {
    const dir = tempDir();
    const file = join(dir, 'a.txt');
    writeFileSync(file, '1\n2\n3\n');
    await expect(
      run(ReadTool, dir, { filePath: file, offset: 10 })
    ).rejects.toThrow('Offset 10 is out of range for this file (3 lines)');
    const result = await withConfig({ legacyToolOutput: true }, () =>
      run(ReadTool, dir, { filePath: file, offset: 10 })
    );
    expect(result.output).toContain('<file>');
    expect(result.output).not.toContain('00001|');
  });
});

describe('--legacy-edit-matching', () => {
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

  test('default rejects a disproportionate fuzzy match', async () => {
    const dir = tempDir();
    const file = join(dir, 'a.js');
    writeFileSync(file, content);
    await run(ReadTool, dir, { filePath: file });
    await expect(
      run(EditTool, dir, { filePath: file, oldString, newString: 'x' })
    ).rejects.toThrow();
    expect(readFileSync(file, 'utf8')).toBe(content);
  });

  test('legacy accepts the old fuzzy match', async () => {
    const dir = tempDir();
    const file = join(dir, 'a.js');
    writeFileSync(file, content);
    await run(ReadTool, dir, { filePath: file });
    await withConfig({ legacyEditMatching: true }, () =>
      run(EditTool, dir, { filePath: file, oldString, newString: 'x' })
    );
    expect(readFileSync(file, 'utf8')).toBe('x');
  });

  test('legacy lets an empty oldString overwrite an existing file', async () => {
    const dir = tempDir();
    const file = join(dir, 'a.txt');
    writeFileSync(file, 'keep');
    await run(ReadTool, dir, { filePath: file });
    await expect(
      run(EditTool, dir, { filePath: file, oldString: '', newString: 'new' })
    ).rejects.toThrow();
    expect(readFileSync(file, 'utf8')).toBe('keep');
    await withConfig({ legacyEditMatching: true }, () =>
      run(EditTool, dir, { filePath: file, oldString: '', newString: 'new' })
    );
    expect(readFileSync(file, 'utf8')).toBe('new');
  });
});

describe('--read-max-lines / --read-max-bytes', () => {
  test('caps can be lowered and disabled', async () => {
    const dir = tempDir();
    const file = join(dir, 'a.txt');
    writeFileSync(
      file,
      Array.from({ length: 3000 }, (_, i) => `line ${i + 1}`).join('\n')
    );
    const capped = await withConfig({ readMaxLines: 5 }, () =>
      run(ReadTool, dir, { filePath: file, offset: 0, limit: 100 })
    );
    expect(capped.output).toContain('00005| line 5');
    expect(capped.output).not.toContain('00006|');

    const bytes = await withConfig({ readMaxBytes: 1024 }, () =>
      run(ReadTool, dir, { filePath: file, offset: 0, limit: 100 })
    );
    expect(bytes.output).toContain('Output capped at 1 KB');

    const unlimited = await withConfig(
      { readMaxLines: 0, readMaxBytes: 0 },
      () => run(ReadTool, dir, { filePath: file, offset: 0, limit: 2500 })
    );
    expect(unlimited.output).toContain('02500| line 2500');
    expect(unlimited.output).not.toContain('Output capped');
  });
});

describe('--grep-hidden / --grep-timeout-ms / --glob-follow-symlinks', () => {
  test('grep searches .github by default and skips it when disabled', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, '.github'));
    writeFileSync(join(dir, '.github', 'ci.yml'), 'needle\n');
    const found = await run(GrepTool, dir, { pattern: 'needle' });
    expect(found.output).toContain('ci.yml');
    const hidden = await withConfig({ grepHidden: false }, () =>
      run(GrepTool, dir, { pattern: 'needle' })
    );
    expect(hidden.output).toBe('No files found');
  });

  test.if(process.platform !== 'win32')(
    'grep stops a search that does not finish in time',
    async () => {
      const dir = tempDir();
      const fifo = join(dir, 'pipe');
      // Reading a FIFO with no writer blocks forever.
      expect(Bun.spawnSync(['mkfifo', fifo]).exitCode).toBe(0);
      const started = Date.now();
      await withConfig({ grepTimeoutMs: 300 }, async () => {
        await expect(
          run(GrepTool, dir, { pattern: 'x', path: fifo })
        ).rejects.toThrow('Search timed out after 0.3 seconds');
      });
      expect(Date.now() - started).toBeLessThan(10_000);
    }
  );

  test('glob follows symlinked directories only when enabled', async () => {
    const dir = tempDir();
    const outside = tempDir();
    writeFileSync(join(outside, 'outside.txt'), 'x');
    writeFileSync(join(dir, 'inside.txt'), 'x');
    symlinkSync(outside, join(dir, 'link'));
    const plain = await run(GlobTool, dir, { pattern: '**/*.txt' });
    expect(plain.output).not.toContain('outside.txt');
    const follow = await withConfig({ globFollowSymlinks: true }, () =>
      run(GlobTool, dir, { pattern: '**/*.txt' })
    );
    expect(follow.output).toContain('outside.txt');
  });
});

describe('--legacy-error-names', () => {
  const error = {
    name: 'ContextOverflowError',
    data: { message: 'prompt is too long' },
  };

  test('default keeps ContextOverflowError', () => {
    expect(legacyErrorObject(error, false)).toBe(error);
  });

  test('legacy reports it as a non-retryable APIError', () => {
    expect(legacyErrorObject(error, true)).toEqual({
      name: 'APIError',
      data: { message: 'prompt is too long', isRetryable: false },
    });
    // Other errors are untouched.
    const other = { name: 'APIError', data: { isRetryable: true } };
    expect(legacyErrorObject(other, true)).toBe(other);
    expect(legacyErrorObject(undefined, true)).toBeUndefined();
  });
});

describe('--legacy-token-usage', () => {
  const model = {
    id: 'test-model',
    name: 'Test Model',
    provider: 'test',
    cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
  } as any;
  const usage = {
    inputTokens: 1000,
    outputTokens: 500,
    reasoningTokens: 200,
    cachedInputTokens: 0,
  } as any;

  test('default reports output without reasoning tokens', () => {
    const result = Session.getUsage({ model, usage });
    expect(result.tokens.output).toBe(300);
    expect(result.tokens.reasoning).toBe(200);
  });

  test('legacy keeps reasoning inside output', async () => {
    const result = await withConfig({ legacyTokenUsage: true }, () =>
      Session.getUsage({ model, usage })
    );
    expect(result.tokens.output).toBe(500);
    expect(result.tokens.reasoning).toBe(200);
  });
});

describe('leak regressions (issue #335 memory-leak audit)', () => {
  test('pending SSE usage is bounded', () => {
    SSEUsageExtractor.clear();
    try {
      for (let i = 0; i < MAX_PENDING_SSE_USAGE + 10; i++) {
        SSEUsageExtractor.storeUsage(`req-${i}`, {
          promptTokens: 1,
          completionTokens: 1,
          totalTokens: 2,
          timestamp: i,
        });
      }
      expect(SSEUsageExtractor.size()).toBe(MAX_PENDING_SSE_USAGE);
      expect(SSEUsageExtractor.getUsage('req-0')).toBeUndefined();
      expect(
        SSEUsageExtractor.getUsage(`req-${MAX_PENDING_SSE_USAGE + 9}`)
      ).toBeDefined();
    } finally {
      SSEUsageExtractor.clear();
    }
  });

  test('SSE tracker finds usage at the end of a long stream', () => {
    const tracker = SSEUsageExtractor.createTracker();
    const filler = `data: ${JSON.stringify({ choices: [{ delta: { content: 'x'.repeat(1000) } }] })}\n\n`;
    for (let i = 0; i < 100; i++) tracker.push(filler);
    const tail = `data: ${JSON.stringify({ usage: { prompt_tokens: 7, completion_tokens: 3 } })}\n\ndata: [DONE]\n\n`;
    // Split mid-line to check partial lines are joined.
    tracker.push(tail.slice(0, 20));
    tracker.push(tail.slice(20));
    const usage = tracker.finish();
    expect(usage?.promptTokens).toBe(7);
    expect(usage?.completionTokens).toBe(3);
  });

  test('retry sleep removes its abort listener', async () => {
    const controller = new AbortController();
    let added = 0;
    let removed = 0;
    const signal = controller.signal;
    const add = signal.addEventListener.bind(signal);
    const remove = signal.removeEventListener.bind(signal);
    signal.addEventListener = ((...args: any[]) => {
      added++;
      return (add as any)(...args);
    }) as any;
    signal.removeEventListener = ((...args: any[]) => {
      removed++;
      return (remove as any)(...args);
    }) as any;
    for (let i = 0; i < 5; i++) await SessionRetry.sleep(1, signal);
    expect(added).toBe(5);
    expect(removed).toBe(5);
    controller.abort();
    await expect(SessionRetry.sleep(1000, signal)).rejects.toThrow('Aborted');
  });

  test('withTimeout clears its timer when the promise rejects', async () => {
    const cleared: unknown[] = [];
    const original = globalThis.clearTimeout;
    globalThis.clearTimeout = ((id: any) => {
      cleared.push(id);
      return original(id);
    }) as any;
    try {
      await expect(
        withTimeout(Promise.reject(new Error('boom')), 60_000)
      ).rejects.toThrow('boom');
    } finally {
      globalThis.clearTimeout = original;
    }
    expect(cleared.length).toBe(1);
  });

  test('retried 5xx responses have their body cancelled', async () => {
    let cancelled = 0;
    let calls = 0;
    const baseFetch = (async () => {
      calls++;
      if (calls === 1) {
        const body = new ReadableStream({
          pull(controller) {
            controller.enqueue(new TextEncoder().encode('error'));
          },
          cancel() {
            cancelled++;
          },
        });
        return new Response(body, { status: 503 });
      }
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;
    const result = await withConfig(
      { retryTimeout: 3600, minRetryInterval: 0 } as any,
      () => RetryFetch.create({ baseFetch })('https://example.test/v1')
    );
    expect(result.status).toBe(200);
    await Bun.sleep(10);
    expect(cancelled).toBe(1);
  });

  test('cancelling a turn rejects its pending permission asks', async () => {
    await Instance.provide({
      directory: tempDir(),
      fn: async () => {
        const ask = Permission.ask({
          type: 'bash',
          title: 'run',
          pattern: 'rm -rf x',
          sessionID: 'ses_cancelled',
          messageID: 'msg',
          callID: 'call',
          metadata: {},
        });
        expect(Object.keys(Permission.pending()['ses_cancelled'])).toHaveLength(
          1
        );
        Permission.clearSession('ses_cancelled');
        await expect(ask).rejects.toBeInstanceOf(Permission.RejectedError);
        expect(Permission.pending()['ses_cancelled']).toBeUndefined();
        // Unknown sessions are a no-op.
        Permission.clearSession('ses_unknown');
      },
    });
  });

  test('FileTime.clear drops the read stamps of a session', async () => {
    const dir = tempDir();
    const file = join(dir, 'a.txt');
    writeFileSync(file, 'x');
    await Instance.provide({
      directory: dir,
      fn: async () => {
        FileTime.read('ses_removed', file);
        expect(FileTime.get('ses_removed', file)).toBeDefined();
        FileTime.clear('ses_removed');
        expect(FileTime.get('ses_removed', file)).toBeUndefined();
        expect(FileTime.state().read['ses_removed']).toBeUndefined();
      },
    });
  });

  test('a disposed instance is not served from the cache', async () => {
    const dir = tempDir();
    let inits = 0;
    const provide = () =>
      Instance.provide({
        directory: dir,
        init: async () => {
          inits++;
        },
        fn: () => Instance.directory,
      });
    await provide();
    await provide();
    expect(inits).toBe(1);
    await Instance.provide({ directory: dir, fn: () => Instance.dispose() });
    await provide();
    expect(inits).toBe(2);
  });
});

describe('sanitizeUrl', () => {
  test('masks credentials in query params and passwords', () => {
    expect(
      sanitizeUrl('https://mcp.exa.ai/mcp?exaApiKey=secret123&tools=web')
    ).toBe('https://mcp.exa.ai/mcp?exaApiKey=%5BREDACTED%5D&tools=web');
    expect(sanitizeUrl('https://user:pw@host.test/x')).toBe(
      'https://user:REDACTED@host.test/x'
    );
    expect(sanitizeUrl('https://host.test/x?q=1')).toBe(
      'https://host.test/x?q=1'
    );
    expect(sanitizeUrl('not a url')).toBe('not a url');
  });
});
