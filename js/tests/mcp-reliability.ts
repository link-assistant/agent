import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Instance } from '../src/project/instance';
import { MCP } from '../src/mcp';

/**
 * MCP connect/list/call reliability ported from upstream OpenCode (#335),
 * exercised against a real stdio server (tests/fixtures/mcp-server.js).
 */

const server = path.join(import.meta.dir, 'fixtures', 'mcp-server.js');
const dirs: string[] = [];

afterAll(async () => {
  await Instance.disposeAll();
  await Promise.all(
    dirs.map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

function local(mode: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'local',
    command: [process.execPath, server, mode],
    ...extra,
  };
}

async function withMcp<R>(
  mcp: Record<string, unknown>,
  fn: () => Promise<R>
): Promise<R> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-mcp-'));
  dirs.push(directory);
  await writeFile(
    path.join(directory, 'opencode.json'),
    JSON.stringify({ mcp })
  );
  return Instance.provide({
    directory,
    fn: async () => {
      try {
        return await fn();
      } finally {
        await Instance.dispose();
      }
    },
  });
}

async function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`did not settle within ${ms}ms`)),
        ms
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

describe('MCP connect (upstream #6760, #25019)', () => {
  test('a server that never answers initialize is marked failed', async () => {
    const status = await withMcp(
      { hung: local('hang', { timeout: 300 }) },
      () => within(MCP.status(), 5000)
    );
    expect(status.hung?.status).toBe('failed');
  });

  test('an invalid remote URL is reported as failed, not dropped', async () => {
    const status = await withMcp(
      { bad: { type: 'remote', url: 'not a url' } },
      () => MCP.status()
    );
    expect(status.bad).toEqual({
      status: 'failed',
      error: 'Invalid MCP URL: not a url',
    });
  });
});

describe('MCP tools listing (upstream #31442, #31271)', () => {
  test('a server without the tools capability stays connected with no tools', async () => {
    const result = await withMcp({ prompts: local('notools') }, async () => ({
      status: await MCP.status(),
      tools: await MCP.tools(),
    }));
    expect(result.status.prompts).toEqual({ status: 'connected' });
    expect(Object.keys(result.tools)).toEqual([]);
  });

  test('a repeated nextCursor fails the server instead of looping', async () => {
    const status = await withMcp({ loop: local('dupcursor') }, () =>
      within(MCP.status(), 5000)
    );
    expect(status.loop?.status).toBe('failed');
  });

  test('a stalled tools/list times out, fails the server and keeps the others', async () => {
    const result = await withMcp(
      {
        stall: local('stall', { timeout: 300 }),
        good: local('ok'),
      },
      async () => {
        const status = await MCP.status();
        expect(status.stall).toEqual({ status: 'connected' });
        const tools = await within(MCP.tools(), 5000);
        return {
          tools,
          status: await MCP.status(),
          clients: await MCP.clients(),
        };
      }
    );
    expect(Object.keys(result.tools)).toEqual(['good_echo']);
    expect(result.status.stall?.status).toBe('failed');
    expect(result.clients.stall).toBeUndefined();
  });
});

describe('MCP tool results (upstream #7879, #32244)', () => {
  test('results without content are normalized', () => {
    expect(MCP.normalizeResult({ structuredContent: { a: 1 } }).output).toBe(
      '{"a":1}'
    );
    expect(MCP.normalizeResult({ toolResult: { b: 2 } }).output).toBe(
      '{"b":2}'
    );
    expect(MCP.normalizeResult({}).output).toBe('');
    expect(MCP.normalizeResult({ content: [], isError: true })).toMatchObject({
      output: 'MCP tool returned an error',
      isError: true,
    });
  });

  test('resource, resource_link and image items reach the model', async () => {
    const result = await withMcp({ srv: local('ok') }, async () => {
      const tools = await MCP.tools();
      const raw = await tools.srv_echo.execute!({ kind: 'resource' }, {
        toolCallId: 'c',
        messages: [],
      } as any);
      return MCP.normalizeResult(raw);
    });
    expect(result.output).toBe(
      [
        'head',
        'resource text',
        '[Binary MCP resource omitted: file:///r.bin (application/octet-stream) is not a supported attachment type]',
        'Resource: link file:///l.txt',
      ].join('\n\n')
    );
    expect(result.attachments).toEqual([
      {
        mime: 'image/png',
        url: 'data:image/png;base64,iVBORw0KGgo=',
        filename: 'file:///r.png',
      },
    ]);
  });
});

describe('MCP tool call timeout', () => {
  test('the timeout aborts the underlying request', async () => {
    let signal: AbortSignal | undefined;
    const error = await MCP.callWithTimeout(
      'srv_slow',
      (abortSignal) => {
        signal = abortSignal;
        return new Promise(() => {});
      },
      50
    ).catch((e) => e);
    expect(String(error)).toContain('MCP tool "srv_slow" timed out');
    expect(signal?.aborted).toBe(true);
  });

  test('the caller abort is forwarded', async () => {
    const controller = new AbortController();
    let signal: AbortSignal | undefined;
    const pending = MCP.callWithTimeout(
      'srv_slow',
      (abortSignal) => {
        signal = abortSignal;
        return new Promise(() => {});
      },
      10_000,
      controller.signal
    );
    controller.abort();
    expect(signal?.aborted).toBe(true);
    pending.catch(() => {});
  });

  test('per-tool timeouts match servers whose name contains "_"', async () => {
    const timeout = await withMcp(
      {
        my_server: local('ok', {
          tool_call_timeout: 1000,
          tool_timeouts: { echo: 4321 },
        }),
        my: local('ok', { tool_call_timeout: 2000 }),
      },
      async () => ({
        echo: await MCP.getToolTimeout('my_server_echo'),
        other: await MCP.getToolTimeout('my_server_other'),
        short: await MCP.getToolTimeout('my_other'),
      })
    );
    expect(timeout).toEqual({ echo: 4321, other: 1000, short: 2000 });
  });
});

describe.skipIf(process.platform === 'win32')(
  'MCP dispose (upstream #15516)',
  () => {
    test('grandchildren of a local server are killed', async () => {
      const marker = `${900 + Math.floor(Math.random() * 99)}.${process.pid}`;
      await withMcp(
        {
          wrapped: {
            type: 'local',
            command: [
              'sh',
              '-c',
              `sleep ${marker} & "${process.execPath}" "${server}" ok`,
            ],
          },
        },
        async () => {
          expect((await MCP.status()).wrapped).toEqual({ status: 'connected' });
        }
      );
      await new Promise((r) => setTimeout(r, 200));
      const found = Bun.spawnSync(['pgrep', '-f', `sleep ${marker}`]);
      const pids = found.stdout.toString().trim();
      if (pids) Bun.spawnSync(['pkill', '-f', `sleep ${marker}`]);
      expect(pids).toBe('');
    });
  }
);
