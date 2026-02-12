import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { $ } from 'bun';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

// Test configuration directory
const testConfigDir = path.join(os.tmpdir(), `opencode-test-${Date.now()}`);
const _configPath = path.join(testConfigDir, 'opencode.json');
const projectRoot = process.cwd();

describe('MCP CLI Commands', () => {
  beforeEach(async () => {
    // Create test config directory
    await fs.mkdir(testConfigDir, { recursive: true });
    // Set environment variable to use test config directory
    process.env.XDG_CONFIG_HOME = testConfigDir;
  });

  afterEach(async () => {
    // Clean up test config directory
    await fs.rm(testConfigDir, { recursive: true, force: true });
    delete process.env.XDG_CONFIG_HOME;
  });

  test('mcp --help shows available commands', async () => {
    const result =
      await $`XDG_CONFIG_HOME=${testConfigDir} bun run ${projectRoot}/src/index.js mcp --help`
        .quiet()
        .nothrow();
    const output = result.stdout.toString();

    expect(output).toContain('mcp add');
    expect(output).toContain('mcp list');
    expect(output).toContain('add an MCP server');
    expect(output).toContain('list configured MCP servers');
  });

  test('mcp add --help shows usage', async () => {
    const result =
      await $`XDG_CONFIG_HOME=${testConfigDir} bun run ${projectRoot}/src/index.js mcp add --help`
        .quiet()
        .nothrow();
    const output = result.stdout.toString();

    expect(output).toContain('[name]');
    expect(output).toContain('[command..]');
    expect(output).toContain('--url');
    expect(output).toContain('--enabled');
  });

  test('mcp add creates correct config for Playwright MCP', async () => {
    // Create config directory for opencode
    const configDir = path.join(testConfigDir, 'opencode');
    await fs.mkdir(configDir, { recursive: true });

    // Run the mcp add command
    const addResult =
      await $`XDG_CONFIG_HOME=${testConfigDir} bun run ${projectRoot}/src/index.js mcp add playwright npx @playwright/mcp@latest`
        .quiet()
        .nothrow();

    // Check the output indicates success
    const stderr = addResult.stderr.toString();
    expect(stderr).toContain('Success');
    expect(stderr).toContain('playwright');

    // Read and verify the config file
    const configContent = await fs.readFile(
      path.join(configDir, 'opencode.json'),
      'utf-8'
    );
    const config = JSON.parse(configContent);

    expect(config.$schema).toBe('https://opencode.ai/config.json');
    expect(config.mcp).toBeDefined();
    expect(config.mcp.playwright).toBeDefined();
    expect(config.mcp.playwright.type).toBe('local');
    expect(config.mcp.playwright.command).toEqual([
      'npx',
      '@playwright/mcp@latest',
    ]);
    expect(config.mcp.playwright.enabled).toBe(true);
  });

  test('mcp add supports multiple arguments for command', async () => {
    // Create config directory for opencode
    const configDir = path.join(testConfigDir, 'opencode');
    await fs.mkdir(configDir, { recursive: true });

    // Run the mcp add command with multiple arguments
    // Note: Arguments that start with -- are interpreted as yargs options
    // For MCP servers, the command parts typically don't include -- prefixed args at CLI level
    await $`XDG_CONFIG_HOME=${testConfigDir} bun run ${projectRoot}/src/index.js mcp add test-mcp node /path/to/server.js arg1 arg2`
      .quiet()
      .nothrow();

    // Read and verify the config file
    const configContent = await fs.readFile(
      path.join(configDir, 'opencode.json'),
      'utf-8'
    );
    const config = JSON.parse(configContent);

    expect(config.mcp['test-mcp']).toBeDefined();
    expect(config.mcp['test-mcp'].command).toEqual([
      'node',
      '/path/to/server.js',
      'arg1',
      'arg2',
    ]);
  });

  test('mcp add with --enabled=false creates disabled server', async () => {
    // Create config directory for opencode
    const configDir = path.join(testConfigDir, 'opencode');
    await fs.mkdir(configDir, { recursive: true });

    // Run the mcp add command with --enabled=false
    await $`XDG_CONFIG_HOME=${testConfigDir} bun run ${projectRoot}/src/index.js mcp add disabled-mcp npx @test/mcp@latest --enabled=false`
      .quiet()
      .nothrow();

    // Read and verify the config file
    const configContent = await fs.readFile(
      path.join(configDir, 'opencode.json'),
      'utf-8'
    );
    const config = JSON.parse(configContent);

    expect(config.mcp['disabled-mcp']).toBeDefined();
    expect(config.mcp['disabled-mcp'].enabled).toBe(false);
  });

  test('mcp add with --url creates remote server config', async () => {
    // Create config directory for opencode
    const configDir = path.join(testConfigDir, 'opencode');
    await fs.mkdir(configDir, { recursive: true });

    // Run the mcp add command with --url
    await $`XDG_CONFIG_HOME=${testConfigDir} bun run ${projectRoot}/src/index.js mcp add remote-server --url https://example.com/mcp`
      .quiet()
      .nothrow();

    // Read and verify the config file
    const configContent = await fs.readFile(
      path.join(configDir, 'opencode.json'),
      'utf-8'
    );
    const config = JSON.parse(configContent);

    expect(config.mcp['remote-server']).toBeDefined();
    expect(config.mcp['remote-server'].type).toBe('remote');
    expect(config.mcp['remote-server'].url).toBe('https://example.com/mcp');
    expect(config.mcp['remote-server'].enabled).toBe(true);
  });

  test('mcp list shows configured servers', async () => {
    // Create config directory and file for opencode
    const configDir = path.join(testConfigDir, 'opencode');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, 'opencode.json'),
      JSON.stringify(
        {
          $schema: 'https://opencode.ai/config.json',
          mcp: {
            playwright: {
              type: 'local',
              command: ['npx', '@playwright/mcp@latest'],
              enabled: true,
            },
            'test-server': {
              type: 'remote',
              url: 'https://example.com/mcp',
              enabled: false,
            },
          },
        },
        null,
        2
      )
    );

    // Run the mcp list command
    const result =
      await $`XDG_CONFIG_HOME=${testConfigDir} bun run ${projectRoot}/src/index.js mcp list`
        .quiet()
        .nothrow();
    const stderr = result.stderr.toString();

    expect(stderr).toContain('playwright');
    expect(stderr).toContain('test-server');
    expect(stderr).toContain('[enabled]');
    expect(stderr).toContain('[disabled]');
    expect(stderr).toContain('npx @playwright/mcp@latest');
    expect(stderr).toContain('https://example.com/mcp');
  });

  test('mcp list shows message when no servers configured', async () => {
    // Create config directory for opencode (empty config)
    const configDir = path.join(testConfigDir, 'opencode');
    await fs.mkdir(configDir, { recursive: true });

    // Run the mcp list command
    const result =
      await $`XDG_CONFIG_HOME=${testConfigDir} bun run ${projectRoot}/src/index.js mcp list`
        .quiet()
        .nothrow();
    const stderr = result.stderr.toString();

    expect(stderr).toContain('No MCP servers configured');
  });

  test('mcp add preserves existing config', async () => {
    // Create config directory and file with existing config
    const configDir = path.join(testConfigDir, 'opencode');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, 'opencode.json'),
      JSON.stringify(
        {
          $schema: 'https://opencode.ai/config.json',
          model: 'opencode/grok-code',
          mcp: {
            'existing-server': {
              type: 'local',
              command: ['npx', '@existing/mcp'],
              enabled: true,
            },
          },
        },
        null,
        2
      )
    );

    // Run the mcp add command
    await $`XDG_CONFIG_HOME=${testConfigDir} bun run ${projectRoot}/src/index.js mcp add playwright npx @playwright/mcp@latest`
      .quiet()
      .nothrow();

    // Read and verify the config file
    const configContent = await fs.readFile(
      path.join(configDir, 'opencode.json'),
      'utf-8'
    );
    const config = JSON.parse(configContent);

    // Check existing config is preserved
    expect(config.model).toBe('opencode/grok-code');
    expect(config.mcp['existing-server']).toBeDefined();
    expect(config.mcp['existing-server'].command).toEqual([
      'npx',
      '@existing/mcp',
    ]);

    // Check new server was added
    expect(config.mcp.playwright).toBeDefined();
    expect(config.mcp.playwright.command).toEqual([
      'npx',
      '@playwright/mcp@latest',
    ]);
  });
});

describe('Playwright MCP Configuration Format', () => {
  beforeEach(async () => {
    await fs.mkdir(testConfigDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = testConfigDir;
  });

  afterEach(async () => {
    await fs.rm(testConfigDir, { recursive: true, force: true });
    delete process.env.XDG_CONFIG_HOME;
  });

  test('config matches expected OpenCode format', async () => {
    // Create config directory for opencode
    const configDir = path.join(testConfigDir, 'opencode');
    await fs.mkdir(configDir, { recursive: true });

    // Add Playwright MCP server
    await $`XDG_CONFIG_HOME=${testConfigDir} bun run ${projectRoot}/src/index.js mcp add playwright npx @playwright/mcp@latest`
      .quiet()
      .nothrow();

    // Read the config
    const configContent = await fs.readFile(
      path.join(configDir, 'opencode.json'),
      'utf-8'
    );
    const config = JSON.parse(configContent);

    // Verify it matches the exact expected format from the issue
    const expectedConfig = {
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        playwright: {
          type: 'local',
          command: ['npx', '@playwright/mcp@latest'],
          enabled: true,
        },
      },
    };

    expect(config).toEqual(expectedConfig);
  });

  test('Claude Code style command format: agent mcp add playwright npx @playwright/mcp@latest', async () => {
    // Create config directory for opencode
    const configDir = path.join(testConfigDir, 'opencode');
    await fs.mkdir(configDir, { recursive: true });

    // This is the exact command format specified in the issue
    const result =
      await $`XDG_CONFIG_HOME=${testConfigDir} bun run ${projectRoot}/src/index.js mcp add playwright npx @playwright/mcp@latest`
        .quiet()
        .nothrow();

    expect(result.exitCode).toBe(0);

    // Verify output indicates success
    const stderr = result.stderr.toString();
    expect(stderr).toContain('Success');
    expect(stderr).toContain('playwright');

    // Read and verify the config
    const configContent = await fs.readFile(
      path.join(configDir, 'opencode.json'),
      'utf-8'
    );
    const config = JSON.parse(configContent);

    expect(config.mcp.playwright.type).toBe('local');
    expect(config.mcp.playwright.command[0]).toBe('npx');
    expect(config.mcp.playwright.command[1]).toBe('@playwright/mcp@latest');
    expect(config.mcp.playwright.enabled).toBe(true);
  });
});
