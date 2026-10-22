import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import z from 'zod';
import { BashTool } from '../src/tool/bash.ts';
import { WebFetchTool } from '../src/tool/webfetch.ts';
import { TaskTool } from '../src/tool/task.ts';
import { WebSearchTool } from '../src/tool/websearch.ts';
import { Tool } from '../src/tool/tool.ts';
import { Instance } from '../src/project/instance.ts';
import { Permission } from '../src/permission/index.ts';
import { config } from '../src/config/config.ts';
import { Bus } from '../src/bus/index.ts';
import { MessageV2 } from '../src/session/message-v2.ts';
import { SessionPrompt } from '../src/session/prompt.ts';

/**
 * Reliability fixes for the bash/web/task tools ported from upstream
 * OpenCode (issue #335). Each test reproduces a defect of the fork:
 * - readonly/plan bash scan ignored output redirects (upstream #6737)
 * - "bash" ran /bin/sh, i.e. dash on Debian/Ubuntu (upstream #3494, #5205)
 * - bash output kept the head, buffered everything, re-sent the whole
 *   output on every chunk and split UTF-8 sequences (upstream #22660,
 *   #39403, #41007)
 * - Tool.define re-wrapped execute on every init() (upstream #16952)
 * - webfetch timer leaked and did not cover the body (upstream #21378, #33259)
 * - webfetch `format` was required (upstream #6345, #30215)
 * - web bodies were buffered without a bound (upstream #33259)
 * - parsed tree-sitter trees were never deleted (upstream #24861)
 * - no Cloudflare challenge retry (upstream #10328, #8284)
 * - text extraction dropped text after <script> (upstream #26309)
 * - TaskTool leaked its Bus subscription on failure (upstream #9992)
 */

const posix = process.platform !== 'win32';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'agent-bash-web-'));
}

function context(
  options: { abort?: AbortSignal; onMetadata?: (input: any) => void } = {}
) {
  return {
    sessionID: 'ses_bash_web',
    messageID: 'msg_bash_web',
    callID: 'call_bash_web',
    agent: 'build',
    abort: options.abort ?? new AbortController().signal,
    metadata(input: any) {
      options.onMetadata?.(input);
    },
  };
}

async function bash(
  directory: string,
  command: string,
  onMetadata?: (input: any) => void
) {
  return Instance.provide({
    directory,
    fn: async () => {
      const tool = await BashTool.init();
      return tool.execute(
        { command, description: 'reliability test' },
        context({ onMetadata })
      );
    },
  });
}

async function webfetch(params: any) {
  return Instance.provide({
    directory: tmpdir(),
    fn: async () => {
      const tool = await WebFetchTool.init();
      return tool.execute(params, context());
    },
  });
}

let savedMode: string;
let savedPermission: string;
beforeEach(() => {
  savedMode = config.permissionMode;
  savedPermission = config.permission;
});
afterEach(async () => {
  config.permissionMode = savedMode;
  config.permission = savedPermission;
  await Instance.disposeAll();
});

describe('bash: write redirects in restricted modes (upstream #6737)', () => {
  test.skipIf(!posix).each([
    ['echo pwned > f.txt', 'f.txt'],
    ['cat /dev/null >> f.txt', 'f.txt'],
    ['{ echo a; } > f.txt', 'f.txt'],
    ['echo a &> f.txt', 'f.txt'],
    ['ls >| f.txt', 'f.txt'],
  ])('readonly rejects %s and writes nothing', async (command, file) => {
    const dir = tempDir();
    try {
      config.permissionMode = 'readonly';
      await expect(bash(dir, command)).rejects.toBeInstanceOf(
        Permission.RejectedError
      );
      expect(existsSync(join(dir, file))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test
    .skipIf(!posix)
    .each([
      'ls 2>/dev/null',
      'echo ok 2>&1',
      'echo ok > /dev/null',
      'cat < in.txt',
    ])('readonly still allows %s', async (command) => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, 'in.txt'), 'in');
      config.permissionMode = 'readonly';
      const result = await bash(dir, command);
      expect(result.metadata.exit).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test.skipIf(!posix)('plan mode asks before a write redirect', async () => {
    const dir = tempDir();
    config.permissionMode = 'plan';
    const asked: any[] = [];
    try {
      await Instance.provide({
        directory: dir,
        fn: async () => {
          const unsub = Bus.subscribe(Permission.Event.Updated, (evt) => {
            asked.push(evt.properties);
            Permission.respond({
              sessionID: evt.properties.sessionID,
              permissionID: evt.properties.id,
              response: 'reject',
            });
          });
          try {
            const tool = await BashTool.init();
            await expect(
              tool.execute({ command: 'echo pwned > f.txt' }, context())
            ).rejects.toBeInstanceOf(Permission.RejectedError);
          } finally {
            unsub();
          }
        },
      });
      expect(asked).toHaveLength(1);
      expect(existsSync(join(dir, 'f.txt'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test.skipIf(!posix)('auto mode still allows redirects', async () => {
    const dir = tempDir();
    try {
      config.permissionMode = 'auto';
      const result = await bash(dir, 'echo ok > f.txt');
      expect(result.metadata.exit).toBe(0);
      expect(existsSync(join(dir, 'f.txt'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('bash: parsed trees are released (upstream #24861)', () => {
  test('every enforced execute deletes its tree', async () => {
    const { Tree } = await import('web-tree-sitter');
    const spy = spyOn(Tree.prototype, 'delete');
    const dir = tempDir();
    try {
      config.permissionMode = 'readonly';
      for (let i = 0; i < 3; i++) await bash(dir, 'echo tree');
      await expect(bash(dir, 'rm -f x')).rejects.toBeInstanceOf(
        Permission.RejectedError
      );
      expect(spy).toHaveBeenCalledTimes(4);
    } finally {
      spy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('bash: shell selection (upstream #3494, #5205)', () => {
  test.skipIf(!posix)('runs bash syntax', async () => {
    const dir = tempDir();
    try {
      const result = await bash(dir, '[[ 1 == 1 ]] && echo {1..3}');
      expect(result.output).toBe('1 2 3\n');
      expect(result.metadata.exit).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test.skipIf(!posix)('ignores a fish or nu $SHELL', async () => {
    const saved = process.env.SHELL;
    process.env.SHELL = '/usr/bin/fish';
    const dir = tempDir();
    try {
      const result = await bash(dir, '[[ 1 == 1 ]] && echo ok');
      expect(result.output).toBe('ok\n');
    } finally {
      if (saved === undefined) delete process.env.SHELL;
      else process.env.SHELL = saved;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('bash: output handling (upstream #22660, #39403, #41007)', () => {
  test.skipIf(!posix)(
    'keeps the tail of long output, where errors are printed',
    async () => {
      const dir = tempDir();
      try {
        const result = await bash(
          dir,
          "printf start; head -c 100000 /dev/zero | tr '\\0' x; echo; echo FINAL-ERROR-LINE; exit 3"
        );
        expect(result.metadata.exit).toBe(3);
        expect(result.output).toStartWith(
          'Exit code 3\n...output truncated...'
        );
        expect(result.output).toContain('FINAL-ERROR-LINE');
        expect(result.output).not.toContain('start');
        expect(result.metadata.output.length).toBeLessThanOrEqual(30_100);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );

  test.skipIf(!posix)(
    'bounds every metadata update instead of resending all output',
    async () => {
      const dir = tempDir();
      const sizes: number[] = [];
      try {
        await bash(
          dir,
          "for i in 1 2 3 4 5 6 7 8; do head -c 200000 /dev/zero | tr '\\0' y; sleep 0.02; done",
          (input) => sizes.push(input.metadata.output.length)
        );
        expect(sizes.length).toBeGreaterThan(1);
        expect(Math.max(...sizes)).toBeLessThanOrEqual(30_006);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );

  test.skipIf(!posix)(
    'decodes a multi-byte character split across chunks',
    async () => {
      const dir = tempDir();
      try {
        const result = await bash(
          dir,
          "printf '\\342\\202'; sleep 0.3; printf '\\254\\n'"
        );
        expect(result.output).toBe('€\n');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );
});

describe('Tool.define (upstream #16952)', () => {
  test('init() does not stack argument validation wrappers', async () => {
    let parses = 0;
    const parameters = z.object({ value: z.string() });
    const original = parameters.parse.bind(parameters);
    (parameters as any).parse = (input: unknown) => {
      parses++;
      return original(input);
    };
    const tool = Tool.define('probe', {
      description: 'probe',
      parameters,
      async execute() {
        return { title: '', output: 'ok', metadata: {} };
      },
    });
    for (let i = 0; i < 4; i++) await tool.init();
    const info = await tool.init();
    await info.execute({ value: 'x' }, context() as any);
    expect(parses).toBe(1);
  });
});

describe('webfetch', () => {
  let server: ReturnType<typeof Bun.serve>;
  let base: string;
  let pulled = 0;
  let agents: string[] = [];

  beforeEach(() => {
    agents = [];
    server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === '/html')
          return new Response('<h1>Title</h1><p>Body</p>', {
            headers: { 'content-type': 'text/html' },
          });
        if (url.pathname === '/script')
          return new Response(
            '<p>Hello <script>x()</script> world</p><style>a{}</style>after<p>tail</p>',
            { headers: { 'content-type': 'text/html' } }
          );
        if (url.pathname === '/cf') {
          const agent = req.headers.get('user-agent') ?? '';
          agents.push(agent);
          if (agent.includes('Chrome'))
            return new Response('challenge', {
              status: 403,
              headers: { 'cf-mitigated': 'challenge' },
            });
          return new Response('real page', {
            headers: { 'content-type': 'text/plain' },
          });
        }
        if (url.pathname === '/forbidden')
          return new Response('no', { status: 403 });
        if (url.pathname === '/trickle') {
          let i = 0;
          return new Response(
            new ReadableStream({
              async pull(c) {
                await Bun.sleep(250);
                if (i++ >= 12) return c.close();
                c.enqueue(new TextEncoder().encode('x'));
              },
            }),
            { headers: { 'content-type': 'text/plain' } }
          );
        }
        if (url.pathname === '/huge') {
          pulled = 0;
          const chunk = new Uint8Array(1024 * 1024).fill(120);
          return new Response(
            new ReadableStream({
              pull(c) {
                if (pulled >= 100) return c.close();
                pulled++;
                c.enqueue(chunk);
              },
            }),
            { headers: { 'content-type': 'text/plain' } }
          );
        }
        return new Response('plain', {
          headers: { 'content-type': 'text/plain' },
        });
      },
    });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterEach(() => {
    server.stop(true);
  });

  test('format is optional and defaults to markdown (upstream #6345)', async () => {
    const result = await webfetch({ url: `${base}/html` });
    expect(result.output).toBe('# Title\n\nBody');
  });

  test('format is not listed as required in the tool schema', async () => {
    const info = await WebFetchTool.init();
    const schema = z.toJSONSchema(info.parameters) as any;
    expect(schema.required).toEqual(['url']);
  });

  test('text format keeps text after <script> (upstream #26309)', async () => {
    const result = await webfetch({ url: `${base}/script`, format: 'text' });
    expect(result.output).toContain('world');
    expect(result.output).toContain('after');
    expect(result.output).toContain('tail');
    expect(result.output).not.toContain('x()');
    expect(result.output).not.toContain('a{}');
  });

  test('retries a Cloudflare challenge with an honest UA (upstream #10328)', async () => {
    const result = await webfetch({ url: `${base}/cf`, format: 'text' });
    expect(result.output).toBe('real page');
    expect(agents).toHaveLength(2);
    expect(agents[0]).toContain('Chrome/143.0.0.0');
    expect(agents[1]).not.toContain('Chrome');
  });

  test('a plain 403 is not retried', async () => {
    await expect(
      webfetch({ url: `${base}/forbidden`, format: 'text' })
    ).rejects.toThrow('Request failed with status code: 403');
  });

  test('timeout covers a body that trickles in (upstream #33259)', async () => {
    const started = performance.now();
    await expect(
      webfetch({ url: `${base}/trickle`, format: 'text', timeout: 1 })
    ).rejects.toThrow(/timed out/i);
    expect(performance.now() - started).toBeLessThan(2500);
  });

  test('stops reading an unbounded body after the size limit (upstream #33259)', async () => {
    await expect(
      webfetch({ url: `${base}/huge`, format: 'text' })
    ).rejects.toThrow('Response too large (exceeds 5MB limit)');
    expect(pulled).toBeLessThan(40);
  });

  test('a failed fetch does not keep the process alive (upstream #21378)', async () => {
    const dir = tempDir();
    const script = join(dir, 'leak.ts');
    const source = fileURLToPath(
      new URL('../src/tool/webfetch.ts', import.meta.url)
    );
    writeFileSync(
      script,
      `const { WebFetchTool } = await import(${JSON.stringify(source)});
const tool = await WebFetchTool.init();
try {
  await tool.execute({ url: 'http://127.0.0.1:9/', format: 'text', timeout: 20 },
    { sessionID: 's', messageID: 'm', agent: 'build', abort: new AbortController().signal, metadata() {} });
} catch (e) {
  console.log('failed');
}
`
    );
    try {
      const started = performance.now();
      const child = Bun.spawn([process.execPath, script], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      await child.exited;
      const elapsed = performance.now() - started;
      expect(await new Response(child.stdout).text()).toContain('failed');
      // The timer was 20 s; the process must exit right after the error.
      expect(elapsed).toBeLessThan(10_000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('websearch and codesearch', () => {
  // The tools capture `fetch` at import time, so run them in a child process
  // whose fetch is redirected to a local server.
  let server: ReturnType<typeof Bun.serve>;
  let pulled = 0;
  let urls: string[] = [];

  beforeEach(() => {
    urls = [];
    server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(req) {
        const url = new URL(req.url);
        urls.push(url.pathname + url.search);
        if (url.searchParams.get('mode') === 'huge') {
          pulled = 0;
          const chunk = new Uint8Array(1024 * 1024).fill(120);
          return new Response(
            new ReadableStream({
              pull(c) {
                if (pulled >= 100) return c.close();
                pulled++;
                c.enqueue(chunk);
              },
            })
          );
        }
        if (url.searchParams.get('mode') === 'json')
          return Response.json({
            jsonrpc: '2.0',
            result: { content: [{ type: 'text', text: 'json result' }] },
          });
        return new Response(
          'event: message\ndata: ' +
            JSON.stringify({
              jsonrpc: '2.0',
              result: { content: [{ type: 'text', text: 'sse result' }] },
            }) +
            '\n\n',
          { headers: { 'content-type': 'text/event-stream' } }
        );
      },
    });
  });

  afterEach(() => {
    server.stop(true);
  });

  async function runChild(
    tool: 'websearch' | 'codesearch',
    mode: string,
    env: Record<string, string> = {}
  ) {
    const dir = tempDir();
    const script = join(dir, 'search.ts');
    const source = fileURLToPath(
      new URL(`../src/tool/${tool}.ts`, import.meta.url)
    );
    const local = `http://127.0.0.1:${server.port}`;
    writeFileSync(
      script,
      `const original = fetch;
globalThis.fetch = ((input, init) => {
  const url = new URL(String(input));
  if (url.origin !== 'https://mcp.exa.ai') throw new Error('unexpected ' + url);
  url.searchParams.set('mode', ${JSON.stringify(mode)});
  return original(${JSON.stringify(local)} + url.pathname + url.search, init);
}) as typeof fetch;
const mod = await import(${JSON.stringify(source)});
const info = await (mod.WebSearchTool ?? mod.CodeSearchTool).init();
try {
  const result = await info.execute({ query: 'q' },
    { sessionID: 's', messageID: 'm', agent: 'build', abort: new AbortController().signal, metadata() {} });
  console.log(JSON.stringify({ output: result.output }));
} catch (e) {
  console.log(JSON.stringify({ error: String(e) }));
}
`
    );
    try {
      const child = Bun.spawn([process.execPath, script], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, EXA_API_KEY: '', ...env },
      });
      await child.exited;
      const out = await new Response(child.stdout).text();
      return JSON.parse(out.trim().split('\n').at(-1)!);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  for (const tool of ['websearch', 'codesearch'] as const) {
    test(`${tool} parses an SSE response`, async () => {
      expect(await runChild(tool, 'sse')).toEqual({ output: 'sse result' });
      expect(urls).toEqual(['/mcp?mode=sse']);
    });

    test(`${tool} accepts a plain JSON response`, async () => {
      expect(await runChild(tool, 'json')).toEqual({ output: 'json result' });
    });

    test(`${tool} sends EXA_API_KEY (upstream #16362)`, async () => {
      await runChild(tool, 'sse', { EXA_API_KEY: 'k e/y' });
      expect(urls).toEqual(['/mcp?exaApiKey=k+e%2Fy&mode=sse']);
    });

    test(`${tool} stops reading an unbounded body (upstream #33259)`, async () => {
      const result = await runChild(tool, 'huge');
      expect(result.error).toContain('Response too large');
      expect(pulled).toBeLessThan(40);
    });
  }
});

test('websearch description names the current year (upstream #13559)', async () => {
  const info = await WebSearchTool.init();
  expect(info.description).toContain(
    `The current year is ${new Date().getFullYear()}.`
  );
  expect(info.description).not.toContain('{{year}}');
});

describe('task tool (upstream #9992)', () => {
  test('unsubscribes from part updates when the subagent fails', async () => {
    const dir = tempDir();
    const prompt = spyOn(SessionPrompt, 'prompt').mockImplementation(
      (async () => {
        throw new Error('provider failed');
      }) as any
    );
    try {
      await Instance.provide({
        directory: dir,
        fn: async () => {
          const updates: any[] = [];
          const tool = await TaskTool.init();
          await expect(
            tool.execute(
              {
                description: 'probe',
                prompt: 'probe',
                subagent_type: 'general',
              },
              context({ onMetadata: (input) => updates.push(input) })
            )
          ).rejects.toThrow('provider failed');
          const sessionID = updates[0].metadata.sessionId;
          const before = updates.length;
          await Bus.publish(MessageV2.Event.PartUpdated, {
            part: {
              id: 'prt_after_failure',
              sessionID,
              messageID: 'msg_other',
              type: 'tool',
              callID: 'call',
              tool: 'bash',
              state: { status: 'pending' },
            } as any,
          });
          expect(updates.length).toBe(before);
        },
      });
    } finally {
      prompt.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
