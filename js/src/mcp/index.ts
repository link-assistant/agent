import { experimental_createMCPClient } from '@ai-sdk/mcp';
import { type Tool } from 'ai';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Config } from '../config/file-config';
import { config } from '../config/config';
import { Log } from '../util/log';
import { NamedError } from '../util/error';
import z from 'zod/v4';
import { Instance } from '../project/instance';
import { withTimeout } from '../util/timeout';
import { spawnSync } from 'node:child_process';

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

  /** Bound on transport startup and `initialize` (upstream DEFAULT_TIMEOUT). */
  const DEFAULT_CONNECT_TIMEOUT = 30_000;
  /** Documented default of the per-server `timeout` for listing tools. */
  const DEFAULT_LIST_TIMEOUT = 5000;
  const MAX_LIST_PAGES = 1000;

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
      // Named `servers`, not `config`: shadowing the imported AgentConfig made
      // both global defaults `undefined`, so every tool timeout became NaN.
      const servers = cfg.mcp ?? {};
      const clients: Record<string, Client> = {};
      const status: Record<string, Status> = {};
      const timeoutConfigs: Record<string, TimeoutConfig> = {};
      const listTimeouts: Record<string, number> = {};
      const processes: Record<string, StdioClientTransport> = {};

      // Determine global timeout defaults from config and environment variables.
      // Uses config.mcp*() which reads from centralized AgentConfig (lino-arguments).
      const globalDefaults: GlobalTimeoutDefaults = {
        defaultTimeout:
          cfg.mcp_defaults?.tool_call_timeout ??
          config.mcpDefaultToolCallTimeout,
        maxTimeout:
          cfg.mcp_defaults?.max_tool_call_timeout ??
          config.mcpMaxToolCallTimeout,
      };

      await Promise.all(
        Object.entries(servers).map(async ([key, mcp]) => {
          // A config that throws while connecting (e.g. a bad URL) must still
          // show up as failed instead of silently disappearing.
          // See: https://github.com/anomalyco/opencode/pull/25019
          const result = await create(key, mcp).catch((error) => ({
            mcpClient: undefined,
            transport: undefined,
            status: {
              status: 'failed' as const,
              error: error instanceof Error ? error.message : String(error),
            },
          }));
          if (!result) return;

          status[key] = result.status;
          listTimeouts[key] = mcp.timeout ?? DEFAULT_LIST_TIMEOUT;

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
            if (result.transport) processes[key] = result.transport;
          }
        })
      );
      return {
        status,
        clients,
        timeoutConfigs,
        listTimeouts,
        processes,
        globalDefaults,
      };
    },
    async (state) => {
      await Promise.all(
        Object.entries(state.clients).map(([key, client]) =>
          closeClient(client, state.processes[key])
        )
      );
    }
  );

  /** Every process below `pid`, collected before the tree is torn down. */
  function descendants(pid: number | null | undefined): number[] {
    if (!pid || process.platform === 'win32') return [];
    const result: number[] = [];
    const queue = [pid];
    while (queue.length > 0) {
      const parent = queue.shift()!;
      const out = spawnSync('pgrep', ['-P', String(parent)], {
        encoding: 'utf8',
      });
      for (const line of (out.stdout ?? '').split('\n')) {
        const child = Number(line.trim());
        if (!child || result.includes(child)) continue;
        result.push(child);
        queue.push(child);
      }
    }
    return result;
  }

  /**
   * Closing the client only stops the direct child; a server started through
   * a wrapper (`sh -c`, `npx`, `uvx`) leaves its real process running.
   * See: https://github.com/anomalyco/opencode/pull/15516
   */
  async function closeClient(client: Client, transport?: StdioClientTransport) {
    const pids = descendants(transport?.pid);
    await client.close().catch((error) => {
      log.error(() => ({
        message: 'Failed to close MCP client',
        error,
      }));
    });
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // already gone
      }
    }
  }

  function sanitize(name: string) {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  /**
   * Lists every tool page with a per-request timeout, bounded against servers
   * that repeat a cursor or never stop paginating. A server without the
   * `tools` capability simply has no tools.
   * See: https://github.com/anomalyco/opencode/pull/31442
   * See: https://github.com/anomalyco/opencode/pull/31271
   */
  async function listTools(
    client: Client,
    timeout: number
  ): Promise<Record<string, Tool>> {
    const definitions: Awaited<ReturnType<Client['listTools']>>['tools'] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const result = await client
        .listTools({
          params: cursor ? { cursor } : undefined,
          options: { timeout },
        })
        .catch((error) => {
          if (
            error instanceof Error &&
            error.message.includes('does not support tools')
          )
            return undefined;
          throw error;
        });
      if (!result) return {};
      definitions.push(...result.tools);
      if (result.nextCursor == null)
        return client.toolsFromDefinitions({ tools: definitions });
      if (seen.has(result.nextCursor))
        throw new Error(
          `MCP server repeated tools/list cursor "${result.nextCursor}"`
        );
      seen.add(result.nextCursor);
      cursor = result.nextCursor;
    }
    throw new Error(`MCP tools/list exceeded ${MAX_LIST_PAGES} pages`);
  }

  export async function add(name: string, mcp: Config.Mcp) {
    const s = await state();
    const result = await create(name, mcp).catch((error) => ({
      mcpClient: undefined,
      transport: undefined,
      status: {
        status: 'failed' as const,
        error: error instanceof Error ? error.message : String(error),
      },
    }));
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
    s.listTimeouts[name] = mcp.timeout ?? DEFAULT_LIST_TIMEOUT;
    if (!result.mcpClient) {
      s.status[name] = result.status;
      return {
        status: s.status,
      };
    }
    s.clients[name] = result.mcpClient;
    if (result.transport) s.processes[name] = result.transport;
    s.status[name] = result.status;

    return {
      status: s.status,
    };
  }

  /**
   * `initialize` gets a deadline and a transport that fails to come up is
   * closed, so a hung server cannot stall startup or leak its process.
   * See: https://github.com/anomalyco/opencode/pull/6760
   */
  async function connect(
    transport: Parameters<typeof experimental_createMCPClient>[0]['transport'],
    timeout: number
  ) {
    return experimental_createMCPClient({
      name: 'opencode',
      transport,
      initializationOptions: { timeout },
    }).catch(async (error) => {
      await (transport as { close?: () => Promise<void> })
        .close?.()
        .catch(() => {});
      throw error;
    });
  }

  async function create(key: string, mcp: Config.Mcp) {
    if (mcp.enabled === false) {
      log.info(() => ({ message: 'mcp server disabled', key }));
      return;
    }
    log.info(() => ({ message: 'found', key, type: mcp.type }));
    let mcpClient: MCPClient | undefined;
    let stdio: StdioClientTransport | undefined;
    let status: Status | undefined = undefined;
    const connectTimeout = mcp.timeout ?? DEFAULT_CONNECT_TIMEOUT;

    if (mcp.type === 'remote') {
      if (!URL.canParse(mcp.url)) {
        return {
          mcpClient: undefined,
          transport: undefined,
          status: {
            status: 'failed' as const,
            error: `Invalid MCP URL: ${mcp.url}`,
          },
        };
      }
      const transports = [
        {
          name: 'StreamableHTTP',
          transport: () =>
            new StreamableHTTPClientTransport(new URL(mcp.url), {
              requestInit: {
                headers: mcp.headers,
              },
            }),
        },
        {
          name: 'SSE',
          transport: () =>
            new SSEClientTransport(new URL(mcp.url), {
              requestInit: {
                headers: mcp.headers,
              },
            }),
        },
      ];
      let lastError: Error | undefined;
      for (const { name, transport } of transports) {
        const result = await connect(transport(), connectTimeout)
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
      const transport = new StdioClientTransport({
        stderr: 'ignore',
        command: cmd,
        args,
        env: {
          ...process.env,
          ...(cmd === 'opencode' ? { BUN_BE_BUN: '1' } : {}),
          ...mcp.environment,
        },
      });
      await connect(transport, connectTimeout)
        .then((client) => {
          mcpClient = client;
          stdio = transport;
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
        transport: undefined,
        status,
      };
    }

    const client: MCPClient = mcpClient;
    const result = await listTools(
      client,
      mcp.timeout ?? DEFAULT_LIST_TIMEOUT
    ).catch((err) => {
      log.error(() => ({
        message: 'failed to get tools from client',
        key,
        error: err instanceof Error ? err.message : String(err),
      }));
      return err instanceof Error ? err : new Error(String(err));
    });
    if (result instanceof Error) {
      await closeClient(client, stdio);
      return {
        mcpClient: undefined,
        transport: undefined,
        status: {
          status: 'failed' as const,
          error: `Failed to get tools: ${result.message}`,
        },
      };
    }

    log.info(() => ({
      message: 'create() successfully created client',
      key,
      toolCount: Object.keys(result).length,
    }));
    return {
      mcpClient: client,
      transport: stdio,
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
    // Servers are listed in parallel, each under its own timeout, so one
    // stalled server cannot hold up the others. A server that fails is closed
    // (not just forgotten) and reported as failed.
    // See: https://github.com/anomalyco/opencode/pull/13229
    const listed = await Promise.all(
      Object.entries(s.clients).map(async ([clientName, client]) => {
        const tools = await listTools(
          client,
          s.listTimeouts[clientName] ?? DEFAULT_LIST_TIMEOUT
        ).catch(async (e) => {
          const error = e instanceof Error ? e.message : String(e);
          log.error(() => ({
            message: 'failed to get tools',
            clientName,
            error,
          }));
          s.status[clientName] = { status: 'failed' as const, error };
          if (s.clients[clientName] === client) {
            delete s.clients[clientName];
            const transport = s.processes[clientName];
            delete s.processes[clientName];
            await closeClient(client, transport);
          }
          return undefined;
        });
        return [clientName, tools] as const;
      })
    );
    for (const [clientName, tools] of listed) {
      if (!tools) continue;
      for (const [toolName, tool] of Object.entries(tools)) {
        result[sanitize(clientName) + '_' + sanitize(toolName)] = tool;
      }
    }
    return result;
  }

  export interface NormalizedResult {
    output: string;
    attachments: { mime: string; url: string; filename?: string }[];
    content: unknown[];
    isError: boolean;
    metadata: Record<string, any>;
  }

  const ATTACHMENT_MIMES = new Set([
    'application/pdf',
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/webp',
  ]);
  const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

  /**
   * Turns an MCP `tools/call` result into text and attachments. Results with
   * no `content` (structured or legacy `toolResult`) and embedded resources
   * used to reach the model as an empty string or crash the loop.
   * See: https://github.com/anomalyco/opencode/pull/7879
   * See: https://github.com/anomalyco/opencode/pull/32244
   */
  export function normalizeResult(result: any): NormalizedResult {
    const content: any[] = Array.isArray(result?.content) ? result.content : [];
    const texts: string[] = [];
    const attachments: NormalizedResult['attachments'] = [];
    if (content.length === 0) {
      if (result?.structuredContent !== undefined)
        texts.push(JSON.stringify(result.structuredContent));
      else if (result && 'toolResult' in result)
        texts.push(JSON.stringify(result.toolResult));
    }
    for (const item of content) {
      if (item?.type === 'text') {
        texts.push(item.text ?? '');
      } else if (item?.type === 'image') {
        attachments.push({
          mime: item.mimeType,
          url: `data:${item.mimeType};base64,${item.data}`,
        });
      } else if (item?.type === 'resource' && item.resource) {
        const resource = item.resource;
        if (typeof resource.text === 'string') {
          texts.push(resource.text);
          continue;
        }
        if (typeof resource.blob !== 'string') continue;
        const mime = resource.mimeType ?? 'application/octet-stream';
        const bytes = Math.floor((resource.blob.length * 3) / 4);
        if (!ATTACHMENT_MIMES.has(mime)) {
          texts.push(
            `[Binary MCP resource omitted: ${resource.uri} (${mime}) is not a supported attachment type]`
          );
        } else if (bytes > MAX_ATTACHMENT_BYTES) {
          texts.push(
            `[Binary MCP resource omitted: ${resource.uri} (${mime}) is larger than 10 MB]`
          );
        } else {
          attachments.push({
            mime,
            url: `data:${mime};base64,${resource.blob}`,
            filename: resource.uri,
          });
        }
      } else if (item?.type === 'resource_link') {
        texts.push(
          `Resource: ${[item.name, item.uri].filter(Boolean).join(' ')}`
        );
      }
    }
    const isError = result?.isError === true;
    const output = texts.join('\n\n');
    return {
      output:
        isError && output.trim() === '' ? 'MCP tool returned an error' : output,
      attachments,
      content,
      isError,
      metadata: result?.metadata ?? {},
    };
  }

  /**
   * Runs an MCP tool call under `timeout`. The request is given its own abort
   * signal (linked to the caller's), which is aborted when the timeout fires,
   * so a timed-out call no longer keeps running in the background.
   */
  export async function callWithTimeout<T>(
    key: string,
    run: (abortSignal: AbortSignal) => PromiseLike<T>,
    timeout: number,
    parent?: AbortSignal
  ): Promise<T> {
    const controller = new AbortController();
    const signal = parent
      ? AbortSignal.any([parent, controller.signal])
      : controller.signal;
    try {
      return await withTimeout(Promise.resolve(run(signal)), timeout);
    } catch (error) {
      controller.abort();
      if (error instanceof Error && error.message.includes('timed out after')) {
        const timeoutSec = Math.round(timeout / 1000);
        throw new Error(
          `MCP tool "${key}" timed out after ${timeoutSec} seconds. ` +
            `The operation did not complete within the configured timeout. ` +
            `You can increase the timeout in the MCP server configuration using tool_call_timeout or tool_timeouts.`
        );
      }
      throw error;
    }
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

    // Format: serverName_toolName (both sanitized). Server names may contain
    // `_` themselves, so the longest matching server prefix wins.
    let match: { prefix: string; config: TimeoutConfig } | undefined;
    for (const [key, cfg] of Object.entries(s.timeoutConfigs)) {
      const prefix = sanitize(key) + '_';
      if (!fullToolName.startsWith(prefix)) continue;
      if (match && match.prefix.length >= prefix.length) continue;
      match = { prefix, config: cfg };
    }
    if (!match) return s.globalDefaults.defaultTimeout;

    // Check for per-tool timeout override
    const toolName = fullToolName.slice(match.prefix.length);
    const perToolTimeout =
      match.config.toolTimeouts[toolName] ??
      Object.entries(match.config.toolTimeouts).find(
        ([name]) => sanitize(name) === toolName
      )?.[1];
    if (perToolTimeout !== undefined) {
      return Math.min(perToolTimeout, maxTimeout);
    }

    return match.config.defaultTimeout;
  }
}
