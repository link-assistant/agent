import { experimental_createMCPClient } from '@ai-sdk/mcp';
import { type Tool } from 'ai';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Config } from '../config/config';
import { Log } from '../util/log';
import { NamedError } from '../util/error';
import z from 'zod/v4';
import { Instance } from '../project/instance';
import { withTimeout } from '../util/timeout';

export namespace MCP {
  const log = Log.create({ service: 'mcp' });

  /** Built-in default timeout for MCP tool execution (2 minutes) */
  export const BUILTIN_DEFAULT_TOOL_CALL_TIMEOUT = 120000;

  /** Built-in maximum timeout for MCP tool execution (10 minutes) */
  export const BUILTIN_MAX_TOOL_CALL_TIMEOUT = 600000;

  /** @deprecated Use BUILTIN_DEFAULT_TOOL_CALL_TIMEOUT instead */
  export const DEFAULT_TOOL_CALL_TIMEOUT = BUILTIN_DEFAULT_TOOL_CALL_TIMEOUT;

  /** @deprecated Use BUILTIN_MAX_TOOL_CALL_TIMEOUT instead */
  export const MAX_TOOL_CALL_TIMEOUT = BUILTIN_MAX_TOOL_CALL_TIMEOUT;

  export const Failed = NamedError.create(
    'MCPFailed',
    z.object({
      name: z.string(),
    })
  );

  type Client = Awaited<ReturnType<typeof experimental_createMCPClient>>;

  /** Global timeout defaults from configuration */
  export interface GlobalTimeoutDefaults {
    /** Global default timeout for MCP tool calls */
    defaultTimeout: number;
    /** Global maximum timeout for MCP tool calls */
    maxTimeout: number;
  }

  /** Timeout configuration for an MCP server */
  export interface TimeoutConfig {
    /** Default timeout for all tool calls from this server */
    defaultTimeout: number;
    /** Per-tool timeout overrides */
    toolTimeouts: Record<string, number>;
  }

  export const Status = z
    .discriminatedUnion('status', [
      z
        .object({
          status: z.literal('connected'),
        })
        .meta({
          ref: 'MCPStatusConnected',
        }),
      z
        .object({
          status: z.literal('disabled'),
        })
        .meta({
          ref: 'MCPStatusDisabled',
        }),
      z
        .object({
          status: z.literal('failed'),
          error: z.string(),
        })
        .meta({
          ref: 'MCPStatusFailed',
        }),
    ])
    .meta({
      ref: 'MCPStatus',
    });
  export type Status = z.infer<typeof Status>;
  type MCPClient = Awaited<ReturnType<typeof experimental_createMCPClient>>;

  const state = Instance.state(
    async () => {
      const cfg = await Config.get();
      const config = cfg.mcp ?? {};
      const clients: Record<string, Client> = {};
      const status: Record<string, Status> = {};
      const timeoutConfigs: Record<string, TimeoutConfig> = {};

      // Determine global timeout defaults from config and environment variables
      const envDefaultTimeout = process.env.MCP_DEFAULT_TOOL_CALL_TIMEOUT
        ? parseInt(process.env.MCP_DEFAULT_TOOL_CALL_TIMEOUT, 10)
        : undefined;
      const envMaxTimeout = process.env.MCP_MAX_TOOL_CALL_TIMEOUT
        ? parseInt(process.env.MCP_MAX_TOOL_CALL_TIMEOUT, 10)
        : undefined;

      const globalDefaults: GlobalTimeoutDefaults = {
        defaultTimeout:
          cfg.mcp_defaults?.tool_call_timeout ??
          envDefaultTimeout ??
          BUILTIN_DEFAULT_TOOL_CALL_TIMEOUT,
        maxTimeout:
          cfg.mcp_defaults?.max_tool_call_timeout ??
          envMaxTimeout ??
          BUILTIN_MAX_TOOL_CALL_TIMEOUT,
      };

      await Promise.all(
        Object.entries(config).map(async ([key, mcp]) => {
          const result = await create(key, mcp).catch(() => undefined);
          if (!result) return;

          status[key] = result.status;

          // Store timeout configuration for this MCP server
          // Per-server timeout overrides global default, but is capped at global max
          const defaultTimeout = Math.min(
            mcp.tool_call_timeout ?? globalDefaults.defaultTimeout,
            globalDefaults.maxTimeout
          );
          timeoutConfigs[key] = {
            defaultTimeout,
            toolTimeouts: mcp.tool_timeouts ?? {},
          };

          if (result.mcpClient) {
            clients[key] = result.mcpClient;
          }
        })
      );
      return {
        status,
        clients,
        timeoutConfigs,
        globalDefaults,
      };
    },
    async (state) => {
      await Promise.all(
        Object.values(state.clients).map((client) =>
          client.close().catch((error) => {
            log.error(() => ({
              message: 'Failed to close MCP client',
              error,
            }));
          })
        )
      );
    }
  );

  export async function add(name: string, mcp: Config.Mcp) {
    const s = await state();
    const result = await create(name, mcp);
    if (!result) {
      const status = {
        status: 'failed' as const,
        error: 'unknown error',
      };
      s.status[name] = status;
      return {
        status,
      };
    }
    if (!result.mcpClient) {
      s.status[name] = result.status;
      return {
        status: s.status,
      };
    }
    s.clients[name] = result.mcpClient;
    s.status[name] = result.status;

    return {
      status: s.status,
    };
  }

  async function create(key: string, mcp: Config.Mcp) {
    if (mcp.enabled === false) {
      log.info(() => ({ message: 'mcp server disabled', key }));
      return;
    }
    log.info(() => ({ message: 'found', key, type: mcp.type }));
    let mcpClient: MCPClient | undefined;
    let status: Status | undefined = undefined;

    if (mcp.type === 'remote') {
      const transports = [
        {
          name: 'StreamableHTTP',
          transport: new StreamableHTTPClientTransport(new URL(mcp.url), {
            requestInit: {
              headers: mcp.headers,
            },
          }),
        },
        {
          name: 'SSE',
          transport: new SSEClientTransport(new URL(mcp.url), {
            requestInit: {
              headers: mcp.headers,
            },
          }),
        },
      ];
      let lastError: Error | undefined;
      for (const { name, transport } of transports) {
        const result = await experimental_createMCPClient({
          name: 'opencode',
          transport,
        })
          .then((client) => {
            log.info(() => ({
              message: 'connected',
              key,
              transport: name,
            }));
            mcpClient = client;
            status = { status: 'connected' };
            return true;
          })
          .catch((error) => {
            lastError =
              error instanceof Error ? error : new Error(String(error));
            log.debug(() => ({
              message: 'transport connection failed',
              key,
              transport: name,
              url: mcp.url,
              error: lastError.message,
            }));
            status = {
              status: 'failed' as const,
              error: lastError.message,
            };
            return false;
          });
        if (result) break;
      }
    }

    if (mcp.type === 'local') {
      const [cmd, ...args] = mcp.command;
      await experimental_createMCPClient({
        name: 'opencode',
        transport: new StdioClientTransport({
          stderr: 'ignore',
          command: cmd,
          args,
          env: {
            ...process.env,
            ...(cmd === 'opencode' ? { BUN_BE_BUN: '1' } : {}),
            ...mcp.environment,
          },
        }),
      })
        .then((client) => {
          mcpClient = client;
          status = {
            status: 'connected',
          };
        })
        .catch((error) => {
          log.error(() => ({
            message: 'local mcp startup failed',
            key,
            command: mcp.command,
            error: error instanceof Error ? error.message : String(error),
          }));
          status = {
            status: 'failed' as const,
            error: error instanceof Error ? error.message : String(error),
          };
        });
    }

    if (!status) {
      status = {
        status: 'failed' as const,
        error: 'Unknown error',
      };
    }

    if (!mcpClient) {
      return {
        mcpClient: undefined,
        status,
      };
    }

    const result = await withTimeout(
      mcpClient.tools(),
      mcp.timeout ?? 5000
    ).catch((err) => {
      log.error(() => ({
        message: 'failed to get tools from client',
        key,
        error: err,
      }));
      return undefined;
    });
    if (!result) {
      await mcpClient.close().catch((error) => {
        log.error(() => ({
          message: 'Failed to close MCP client',
          error,
        }));
      });
      status = {
        status: 'failed',
        error: 'Failed to get tools',
      };
      return {
        mcpClient: undefined,
        status: {
          status: 'failed' as const,
          error: 'Failed to get tools',
        },
      };
    }

    log.info(() => ({
      message: 'create() successfully created client',
      key,
      toolCount: Object.keys(result).length,
    }));
    return {
      mcpClient,
      status,
    };
  }

  export async function status() {
    return state().then((state) => state.status);
  }

  export async function clients() {
    return state().then((state) => state.clients);
  }

  export async function tools() {
    const result: Record<string, Tool> = {};
    const s = await state();
    const clientsSnapshot = await clients();
    for (const [clientName, client] of Object.entries(clientsSnapshot)) {
      const tools = await client.tools().catch((e) => {
        log.error(() => ({
          message: 'failed to get tools',
          clientName,
          error: e.message,
        }));
        const failedStatus = {
          status: 'failed' as const,
          error: e instanceof Error ? e.message : String(e),
        };
        s.status[clientName] = failedStatus;
        delete s.clients[clientName];
      });
      if (!tools) {
        continue;
      }
      for (const [toolName, tool] of Object.entries(tools)) {
        const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, '_');
        const sanitizedToolName = toolName.replace(/[^a-zA-Z0-9_-]/g, '_');
        result[sanitizedClientName + '_' + sanitizedToolName] = tool;
      }
    }
    return result;
  }

  /**
   * Get the timeout configuration for all MCP servers
   */
  export async function getTimeoutConfigs(): Promise<
    Record<string, TimeoutConfig>
  > {
    const s = await state();
    return s.timeoutConfigs;
  }

  /**
   * Get the global timeout defaults from configuration
   */
  export async function getGlobalDefaults(): Promise<GlobalTimeoutDefaults> {
    const s = await state();
    return s.globalDefaults;
  }

  /**
   * Get the timeout for a specific MCP tool
   * @param fullToolName The full tool name in format "serverName_toolName"
   * @returns Timeout in milliseconds
   */
  export async function getToolTimeout(fullToolName: string): Promise<number> {
    const s = await state();
    const maxTimeout = s.globalDefaults.maxTimeout;

    // Parse the full tool name to extract server name and tool name
    // Format: serverName_toolName (where both are sanitized)
    const underscoreIndex = fullToolName.indexOf('_');
    if (underscoreIndex === -1) {
      return s.globalDefaults.defaultTimeout;
    }

    const serverName = fullToolName.substring(0, underscoreIndex);
    const toolName = fullToolName.substring(underscoreIndex + 1);

    // Find the server config (need to handle sanitization)
    const config = s.timeoutConfigs[serverName];
    if (!config) {
      // Try to find by iterating (in case of sanitization differences)
      for (const [key, cfg] of Object.entries(s.timeoutConfigs)) {
        const sanitizedKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
        if (sanitizedKey === serverName) {
          // Check for per-tool timeout override
          const perToolTimeout = cfg.toolTimeouts[toolName];
          if (perToolTimeout !== undefined) {
            return Math.min(perToolTimeout, maxTimeout);
          }
          return cfg.defaultTimeout;
        }
      }
      return s.globalDefaults.defaultTimeout;
    }

    // Check for per-tool timeout override
    const perToolTimeout = config.toolTimeouts[toolName];
    if (perToolTimeout !== undefined) {
      return Math.min(perToolTimeout, maxTimeout);
    }

    return config.defaultTimeout;
  }
}
