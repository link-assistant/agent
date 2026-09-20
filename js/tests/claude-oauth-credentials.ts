import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { ClaudeOAuth } from '../src/auth/claude-oauth';

const temporaryDirectories: string[] = [];

afterAll(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function credentialsWith(
  metadata: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    claudeAiOauth: {
      accessToken: 'redacted-access-token',
      refreshToken: 'redacted-refresh-token',
      expiresAt: Date.now() + 60_000,
      ...metadata,
    },
  };
}

describe('Claude OAuth credential metadata', () => {
  test('treats null optional subscription metadata as absent', () => {
    const result = ClaudeOAuth.Credentials.safeParse(
      credentialsWith({ subscriptionType: null, rateLimitTier: null })
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.claudeAiOauth?.subscriptionType).toBeUndefined();
    expect(result.data.claudeAiOauth?.rateLimitTier).toBeUndefined();
  });

  test('accepts missing optional subscription metadata', () => {
    const result = ClaudeOAuth.Credentials.safeParse(credentialsWith());

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.claudeAiOauth?.subscriptionType).toBeUndefined();
    expect(result.data.claudeAiOauth?.rateLimitTier).toBeUndefined();
  });

  test('preserves string subscription metadata', () => {
    const result = ClaudeOAuth.Credentials.safeParse(
      credentialsWith({
        subscriptionType: 'max',
        rateLimitTier: 'default_claude_max_20x',
      })
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.claudeAiOauth?.subscriptionType).toBe('max');
    expect(result.data.claudeAiOauth?.rateLimitTier).toBe(
      'default_claude_max_20x'
    );
  });

  test.each([
    ['accessToken', { accessToken: null }],
    ['refreshToken', { refreshToken: null }],
    ['expiresAt', { expiresAt: null }],
  ])('continues to reject an invalid required %s', (_field, override) => {
    expect(
      ClaudeOAuth.Credentials.safeParse(credentialsWith(override)).success
    ).toBe(false);
  });
});

test('unselected Claude discovery emits no error for null metadata', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-claude-oauth-'));
  temporaryDirectories.push(root);

  const home = join(root, 'home');
  const cacheHome = join(root, 'cache');
  const dataHome = join(root, 'data');
  const configHome = join(root, 'config');
  const stateHome = join(root, 'state');
  const claudeDirectory = join(home, '.claude');
  const modelCacheDirectory = join(cacheHome, 'link-assistant-agent');
  mkdirSync(claudeDirectory, { recursive: true });
  mkdirSync(modelCacheDirectory, { recursive: true });

  writeFileSync(
    join(claudeDirectory, '.credentials.json'),
    JSON.stringify(
      credentialsWith({ subscriptionType: null, rateLimitTier: null })
    )
  );
  writeFileSync(join(modelCacheDirectory, 'version'), '9');
  writeFileSync(
    join(modelCacheDirectory, 'models.json'),
    await Bun.file(
      resolve(
        process.cwd(),
        '../docs/case-studies/issue-53/models-dev-api.json'
      )
    ).text()
  );

  const script = `
    import { parseModelConfig } from './src/cli/model-config.js';
    import { initConfig, resetConfig } from './src/config/config.ts';
    import { Log } from './src/util/log.ts';
    import { Instance } from './src/project/instance.ts';

    process.argv = ['bun', 'agent', '--model', 'formalai/formal-ai', '--verbose'];
    resetConfig();
    initConfig(process.argv);
    await Log.init({ print: true, level: 'DEBUG', compactJson: true });
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        await parseModelConfig(
          { model: 'formalai/formal-ai', 'compaction-models': '(same)' },
          () => {},
          () => {},
          { defaultCompactionModels: '(same)' }
        );
      },
    });
    await Instance.disposeAll();
  `;

  const proc = Bun.spawn({
    cmd: ['bun', '--eval', script],
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      HOME: home,
      XDG_CACHE_HOME: cacheHome,
      XDG_CONFIG_HOME: configHome,
      XDG_DATA_HOME: dataHome,
      XDG_STATE_HOME: stateHome,
      FORMAL_AI_API_KEY: 'local-test-token',
      LINK_ASSISTANT_AGENT_CONFIG_CONTENT: '{}',
      LINK_ASSISTANT_AGENT_DEFAULT_COMPACTION_MODELS: '(same)',
    },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `provider discovery exited with ${exitCode}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`
    );
  }

  const logs = stdout
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    });

  expect(
    logs.some(
      (log) => log.service === 'provider' && log.providerID === 'formalai'
    )
  ).toBe(true);
  expect(
    logs.some((log) => log.service === 'claude-oauth' && log.level === 'error')
  ).toBe(false);
});
