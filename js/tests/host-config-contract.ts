import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HostConfigHint } from '../src/config/host-config-hint';

/**
 * The host integration contract: a host that embeds the CLI supplies config
 * through LINK_ASSISTANT_AGENT_CONFIG_DIR / _CONFIG / _CONFIG_CONTENT and
 * leaves XDG_CONFIG_HOME alone, so the tools the agent runs (gh, git) keep
 * the caller's config and credentials.
 *
 * @see https://github.com/link-assistant/agent/issues/314
 * @see ../../docs/host-integration.md
 */

setDefaultTimeout(60000);

describe('HostConfigHint.detect (#314)', () => {
  const home = '/home/caller';

  test('no hint when XDG_CONFIG_HOME is unset or is the real config home', () => {
    expect(HostConfigHint.detect({}, home)).toBeUndefined();
    expect(
      HostConfigHint.detect({ XDG_CONFIG_HOME: '/home/caller/.config' }, home)
    ).toBeUndefined();
    expect(
      HostConfigHint.detect({ XDG_CONFIG_HOME: '/home/caller/.config/' }, home)
    ).toBeUndefined();
  });

  test('hints when XDG_CONFIG_HOME is relocated and no agent config var is set', () => {
    const hint = HostConfigHint.detect(
      { XDG_CONFIG_HOME: '/tmp/host-generated' },
      home
    );
    expect(hint).toBeDefined();
    expect(hint!.xdgConfigHome).toBe('/tmp/host-generated');
    expect(hint!.realConfigHome).toBe(path.join(home, '.config'));
    for (const name of HostConfigHint.CONFIG_ENV_VARS) {
      expect(hint!.hint).toContain(name);
    }
    // One line, as the issue asks.
    expect(hint!.hint).not.toContain('\n');
  });

  test('no hint once the host uses any of the agent config vars', () => {
    for (const name of HostConfigHint.CONFIG_ENV_VARS) {
      expect(
        HostConfigHint.detect(
          { XDG_CONFIG_HOME: '/tmp/host-generated', [name]: 'x' },
          home
        )
      ).toBeUndefined();
    }
  });
});

/**
 * A provider that answers the first turn with one bash tool call and the
 * second with plain text, recording the tool output the agent sends back.
 */
async function startToolCallingProvider(command: string) {
  const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
  const toolResults: string[] = [];

  const server = createServer((request, response) => {
    if (request.url?.includes('/models')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ object: 'list', data: [{ id: 'host-model' }] })
      );
      return;
    }

    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      const parsed = JSON.parse(body || '{}') as {
        messages?: Array<{ role: string; content: unknown }>;
      };
      const results = (parsed.messages ?? []).filter(
        (message) => message.role === 'tool'
      );
      for (const result of results) {
        toolResults.push(
          typeof result.content === 'string'
            ? result.content
            : JSON.stringify(result.content)
        );
      }

      const chunk = (
        delta: Record<string, unknown>,
        finishReason: string | null = null,
        extra: Record<string, unknown> = {}
      ) =>
        `data: ${JSON.stringify({
          id: 'chatcmpl-fake',
          object: 'chat.completion.chunk',
          created: 0,
          model: 'host-model',
          choices: [{ index: 0, delta, finish_reason: finishReason }],
          ...extra,
        })}\n\n`;

      response.writeHead(200, { 'content-type': 'text/event-stream' });
      if (results.length === 0) {
        response.write(
          chunk({
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'bash',
                  arguments: JSON.stringify({ command }),
                },
              },
            ],
          })
        );
        response.write(chunk({}, 'tool_calls', { usage }));
      } else {
        response.write(chunk({ role: 'assistant', content: 'done' }));
        response.write(chunk({}, 'stop', { usage }));
      }
      response.end('data: [DONE]\n\n');
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;

  return {
    toolResults,
    baseURL: `http://127.0.0.1:${port}/v1`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

/**
 * A tool command that runs the same under `sh` and Windows `cmd`: a Bun
 * one-liner with no shell expansion, `%` or double quotes inside.
 */
const bunEval = (code: string) => `"${process.execPath}" -e "${code}"`;

/** Print the caller's gh config as the tool sees it, or NO_GH_CONFIG. */
const readGhConfig = bunEval(
  "const f = require('path').join(process.env.XDG_CONFIG_HOME, 'gh', 'hosts.yml'); " +
    "try { console.log(require('fs').readFileSync(f, 'utf8')) } catch { console.log('NO_GH_CONFIG') }"
);

/** A config dir holding a provider that exists nowhere else. */
function writeHostConfigDir(
  baseURL: string,
  dir = mkdtempSync(path.join(tmpdir(), 'agent-host-config-'))
) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'opencode.json'),
    JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      provider: {
        hostcfg: {
          name: 'Host-supplied provider',
          npm: '@ai-sdk/openai-compatible',
          options: { baseURL, apiKey: 'local-test-token' },
          models: {
            'host-model': {
              name: 'host-model',
              tool_call: true,
              limit: { context: null },
            },
          },
        },
      },
    })
  );
  return dir;
}

/**
 * Run one turn against `hostcfg/host-model`. The provider config goes into
 * LINK_ASSISTANT_AGENT_CONFIG_DIR, or — with `relocateXdgTo` — into a
 * relocated XDG_CONFIG_HOME, the way hosts did it before #314.
 */
async function runHostedTurn(options: {
  command: string;
  env?: Record<string, string | undefined>;
  relocateXdgTo?: string;
  jsonStandard?: 'opencode' | 'claude';
}) {
  const provider = await startToolCallingProvider(options.command);
  const configDir = options.relocateXdgTo
    ? writeHostConfigDir(
        provider.baseURL,
        path.join(options.relocateXdgTo, 'link-assistant-agent')
      )
    : writeHostConfigDir(provider.baseURL);
  try {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries({
      ...process.env,
      LINK_ASSISTANT_AGENT_COMPACT_JSON: '1',
      LINK_ASSISTANT_AGENT_CONFIG_DIR: options.relocateXdgTo
        ? undefined
        : configDir,
      LINK_ASSISTANT_AGENT_CONFIG: undefined,
      LINK_ASSISTANT_AGENT_CONFIG_CONTENT: undefined,
      ...(options.relocateXdgTo
        ? { XDG_CONFIG_HOME: options.relocateXdgTo }
        : {}),
      ...options.env,
    })) {
      if (value !== undefined) env[key] = value;
    }

    const proc = Bun.spawn({
      cmd: [
        'bun',
        'run',
        'src/index.js',
        '--model',
        'hostcfg/host-model',
        '--no-summarize-session',
        '--no-generate-title',
        '--verbose',
        '--no-always-accept-stdin',
        '--no-server',
        '--json-standard',
        options.jsonStandard ?? 'opencode',
      ],
      cwd: process.cwd(),
      stdin: new TextEncoder().encode('check gh\n'),
      stdout: 'pipe',
      stderr: 'pipe',
      env,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    return {
      exitCode,
      toolOutput: provider.toolResults.join('\n'),
      records: `${stdout}\n${stderr}`
        .split('\n')
        .filter((line) => line.trim().startsWith('{'))
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as Record<string, any>];
          } catch {
            return [];
          }
        }),
      context: `exit=${exitCode}\ntool results:\n${provider.toolResults.join('\n')}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    };
  } finally {
    await provider.close();
    rmSync(configDir, { recursive: true, force: true });
  }
}

const relocationHints = (records: Record<string, any>[]) =>
  records.filter((record) => record.message === 'XDG_CONFIG_HOME is relocated');

describe('LINK_ASSISTANT_AGENT_CONFIG_DIR as the host contract (#314)', () => {
  test('config comes from the dir while bash keeps the caller config home', async () => {
    // The caller's config home, with a gh config in it — the thing a host
    // that relocates XDG_CONFIG_HOME would hide.
    const callerConfigHome = mkdtempSync(
      path.join(tmpdir(), 'agent-caller-config-')
    );
    mkdirSync(path.join(callerConfigHome, 'gh'));
    writeFileSync(
      path.join(callerConfigHome, 'gh', 'hosts.yml'),
      'github.com:\n    user: caller-marker\n'
    );

    try {
      const run = await runHostedTurn({
        command: readGhConfig,
        env: { XDG_CONFIG_HOME: callerConfigHome },
      });

      // `hostcfg` is only defined in the config dir: reaching the turn at
      // all means the dir was honoured.
      expect(run.exitCode, run.context).toBe(0);
      expect(run.toolOutput, run.context).toContain('caller-marker');
      // The host used the contract, so there is nothing to hint about.
      expect(relocationHints(run.records), run.context).toEqual([]);
    } finally {
      rmSync(callerConfigHome, { recursive: true, force: true });
    }
  });

  test('delivering config by relocating XDG_CONFIG_HOME hides the caller gh config, and gets a hint', async () => {
    const callerConfigHome = mkdtempSync(
      path.join(tmpdir(), 'agent-caller-config-')
    );
    mkdirSync(path.join(callerConfigHome, 'gh'));
    writeFileSync(
      path.join(callerConfigHome, 'gh', 'hosts.yml'),
      'github.com:\n    user: caller-marker\n'
    );
    const relocated = mkdtempSync(path.join(tmpdir(), 'agent-relocated-'));

    try {
      const run = await runHostedTurn({
        command: readGhConfig,
        // The caller's config home was `callerConfigHome`; the host swaps
        // it for its own directory to deliver the agent config.
        relocateXdgTo: relocated,
      });

      // The pre-#314 host setup works for the agent's own config...
      expect(run.exitCode, run.context).toBe(0);
      // ...but the tool call no longer finds the caller's gh config.
      expect(run.toolOutput, run.context).toContain('NO_GH_CONFIG');
      expect(run.toolOutput, run.context).not.toContain('caller-marker');

      const hints = relocationHints(run.records);
      expect(hints.length, run.context).toBe(1);
      expect(hints[0].level, run.context).toBe('warn');
      expect(hints[0].xdgConfigHome, run.context).toBe(relocated);
      expect(hints[0].hint, run.context).toContain(
        'LINK_ASSISTANT_AGENT_CONFIG_DIR'
      );
    } finally {
      rmSync(callerConfigHome, { recursive: true, force: true });
      rmSync(relocated, { recursive: true, force: true });
    }
  });

  // The acceptance check itself needs a caller that really is signed in to
  // gh through its config (not a token variable), so it only runs where one
  // is — e.g. a developer machine.
  const callerGhAuthenticated =
    !process.env.GH_TOKEN &&
    !process.env.GITHUB_TOKEN &&
    spawnSync('gh', ['auth', 'status'], { stdio: 'ignore' }).status === 0;

  test.if(callerGhAuthenticated)(
    "bash in a session configured by the dir sees the caller's gh auth",
    async () => {
      const run = await runHostedTurn({
        command: bunEval(
          "console.log('GH_AUTH_EXIT=' + require('child_process').spawnSync('gh', ['auth', 'status']).status)"
        ),
      });
      expect(run.exitCode, run.context).toBe(0);
      expect(run.toolOutput, run.context).toContain('GH_AUTH_EXIT=0');
    }
  );
});

describe('process failures reach the provider and stream-json (#317)', () => {
  test('exit 4 is visible to an OpenAI-compatible provider and keeps metadata', async () => {
    const run = await runHostedTurn({
      command: bunEval(
        "console.log('Please run gh auth login'); process.exit(4)"
      ),
    });
    expect(run.exitCode, run.context).toBe(0);
    expect(run.toolOutput, run.context).toBe(
      'Exit code 4\nPlease run gh auth login\n'
    );
    const failed = run.records.find(
      (record) =>
        record.part?.type === 'tool' && record.part.state?.status === 'error'
    );
    expect(failed?.part.state.error, run.context).toBe(run.toolOutput);
    expect(failed?.part.state.metadata.exit, run.context).toBe(4);
  });

  test('Claude stream-json flags a quiet command failure', async () => {
    const run = await runHostedTurn({
      command: bunEval('process.exit(1)'),
      jsonStandard: 'claude',
    });
    expect(run.exitCode, run.context).toBe(0);
    expect(run.toolOutput, run.context).toBe('Exit code 1\n');
    const results = run.records.filter(
      (record) => record.type === 'tool_result'
    );
    expect(results, run.context).toHaveLength(1);
    expect(results[0], run.context).toMatchObject({
      status: 'error',
      output: 'Exit code 1',
    });
  });

  test('a successful command retains its provider output and stream status', async () => {
    const run = await runHostedTurn({
      command: bunEval("console.log('hello')"),
      jsonStandard: 'claude',
    });
    expect(run.exitCode, run.context).toBe(0);
    expect(run.toolOutput, run.context).toBe('hello\n');
    const results = run.records.filter(
      (record) => record.type === 'tool_result'
    );
    expect(results, run.context).toHaveLength(1);
    expect(results[0], run.context).toMatchObject({
      status: 'success',
      output: 'hello\n',
    });
  });
});
