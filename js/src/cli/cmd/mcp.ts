import type { Argv } from 'yargs';
import { cmd } from './cmd';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import * as prompts from '@clack/prompts';
import { UI } from '../ui';
import { Global } from '../../global';
import { Config } from '../../config/config';
import path from 'path';
import fs from 'fs/promises';

export const McpCommand = cmd({
  command: 'mcp',
  builder: (yargs) =>
    yargs.command(McpAddCommand).command(McpListCommand).demandCommand(),
  async handler() {},
});

async function loadGlobalConfig(): Promise<Config.Info> {
  const configPath = path.join(Global.Path.config, 'opencode.json');
  try {
    const content = await Bun.file(configPath).text();
    return JSON.parse(content);
  } catch {
    return {
      $schema: 'https://opencode.ai/config.json',
    };
  }
}

async function saveGlobalConfig(config: Config.Info): Promise<void> {
  const configPath = path.join(Global.Path.config, 'opencode.json');
  await fs.mkdir(Global.Path.config, { recursive: true });
  await Bun.write(configPath, JSON.stringify(config, null, 2));
}

export const McpAddCommand = cmd({
  command: 'add [name] [command..]',
  describe: 'add an MCP server',
  builder: (yargs: Argv) => {
    return yargs
      .positional('name', {
        describe: 'name of the MCP server',
        type: 'string',
      })
      .positional('command', {
        describe:
          'command and arguments to run the MCP server (e.g., npx @playwright/mcp@latest)',
        type: 'string',
        array: true,
      })
      .option('url', {
        describe: 'URL for remote MCP server',
        type: 'string',
      })
      .option('enabled', {
        describe: 'enable the MCP server',
        type: 'boolean',
        default: true,
      });
  },
  async handler(args) {
    // If name and command are provided as CLI arguments, use non-interactive mode
    if (args.name && ((args.command && args.command.length > 0) || args.url)) {
      // Non-interactive mode: CLI arguments provided
      const config = await loadGlobalConfig();
      config.mcp = config.mcp || {};

      if (args.url) {
        // Remote MCP server
        config.mcp[args.name] = {
          type: 'remote',
          url: args.url,
          enabled: args.enabled,
        };
        UI.success(
          `Remote MCP server "${args.name}" added with URL: ${args.url}`
        );
      } else if (args.command && args.command.length > 0) {
        // Local MCP server
        config.mcp[args.name] = {
          type: 'local',
          command: args.command,
          enabled: args.enabled,
        };
        UI.success(
          `Local MCP server "${args.name}" added with command: ${args.command.join(' ')}`
        );
      }

      await saveGlobalConfig(config);
      const configPath = path.join(Global.Path.config, 'opencode.json');
      UI.info(`Configuration saved to: ${configPath}`);
      return;
    }

    // Interactive mode: prompt for input
    UI.empty();
    prompts.intro('Add MCP server');

    const name = await prompts.text({
      message: 'Enter MCP server name',
      validate: (x) => (x && x.length > 0 ? undefined : 'Required'),
    });
    if (prompts.isCancel(name)) throw new UI.CancelledError();

    const type = await prompts.select({
      message: 'Select MCP server type',
      options: [
        {
          label: 'Local',
          value: 'local',
          hint: 'Run a local command',
        },
        {
          label: 'Remote',
          value: 'remote',
          hint: 'Connect to a remote URL',
        },
      ],
    });
    if (prompts.isCancel(type)) throw new UI.CancelledError();

    const config = await loadGlobalConfig();
    config.mcp = config.mcp || {};

    if (type === 'local') {
      const command = await prompts.text({
        message: 'Enter command to run',
        placeholder: 'e.g., npx @playwright/mcp@latest',
        validate: (x) => (x && x.length > 0 ? undefined : 'Required'),
      });
      if (prompts.isCancel(command)) throw new UI.CancelledError();

      // Parse command into array
      const commandParts = command.split(/\s+/);
      config.mcp[name] = {
        type: 'local',
        command: commandParts,
        enabled: true,
      };

      await saveGlobalConfig(config);
      prompts.log.info(
        `Local MCP server "${name}" configured with command: ${command}`
      );
    }

    if (type === 'remote') {
      const url = await prompts.text({
        message: 'Enter MCP server URL',
        placeholder: 'e.g., https://example.com/mcp',
        validate: (x) => {
          if (!x) return 'Required';
          if (x.length === 0) return 'Required';
          const isValid = URL.canParse(x);
          return isValid ? undefined : 'Invalid URL';
        },
      });
      if (prompts.isCancel(url)) throw new UI.CancelledError();

      // Test connection
      try {
        const client = new Client({
          name: 'opencode',
          version: '1.0.0',
        });
        const transport = new StreamableHTTPClientTransport(new URL(url));
        await client.connect(transport);
        await client.close();
      } catch (error) {
        prompts.log.warn(
          `Could not verify connection to ${url}, but saving configuration anyway`
        );
      }

      config.mcp[name] = {
        type: 'remote',
        url: url,
        enabled: true,
      };

      await saveGlobalConfig(config);
      prompts.log.info(
        `Remote MCP server "${name}" configured with URL: ${url}`
      );
    }

    const configPath = path.join(Global.Path.config, 'opencode.json');
    prompts.log.info(`Configuration saved to: ${configPath}`);
    prompts.outro('MCP server added successfully');
  },
});

export const McpListCommand = cmd({
  command: 'list',
  describe: 'list configured MCP servers',
  async handler() {
    const config = await loadGlobalConfig();
    const mcpServers = config.mcp || {};

    if (Object.keys(mcpServers).length === 0) {
      UI.info('No MCP servers configured');
      return;
    }

    UI.println(
      UI.Style.TEXT_BOLD + 'Configured MCP servers:' + UI.Style.TEXT_NORMAL
    );
    UI.empty();

    for (const [name, server] of Object.entries(mcpServers)) {
      const enabledStatus =
        server.enabled !== false
          ? UI.Style.TEXT_SUCCESS_BOLD + '[enabled]'
          : UI.Style.TEXT_DIM + '[disabled]';
      UI.println(
        UI.Style.TEXT_INFO_BOLD +
          `  ${name}` +
          UI.Style.TEXT_NORMAL +
          ` ${enabledStatus}` +
          UI.Style.TEXT_NORMAL
      );

      if (server.type === 'local') {
        UI.println(UI.Style.TEXT_DIM + `    Type: local`);
        UI.println(
          UI.Style.TEXT_DIM + `    Command: ${server.command.join(' ')}`
        );
      } else if (server.type === 'remote') {
        UI.println(UI.Style.TEXT_DIM + `    Type: remote`);
        UI.println(UI.Style.TEXT_DIM + `    URL: ${server.url}`);
      }
      UI.empty();
    }
  },
});
