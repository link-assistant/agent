import { Log } from '../util/log';
import path from 'path';
import z from 'zod';
import { Identifier } from '../id/id';
import { MessageV2 } from './message-v2';
import { Session } from '.';
import { Agent } from '../agent/agent';
import { Provider } from '../provider/provider';
import {
  generateText,
  streamText,
  type Tool as AITool,
  tool,
  wrapLanguageModel,
  isStepCount,
  jsonSchema,
  asSchema,
} from 'ai';
import { Bus } from '../bus';
import { ProviderTransform } from '../provider/transform';
import { SystemPrompt } from './system';
import { config, isVerbose } from '../config/config';
import PROMPT_PLAN from '../session/prompt/plan.txt';
import BUILD_SWITCH from '../session/prompt/build-switch.txt';
import { mergeDeep, pipe } from 'remeda';
import { ToolRegistry } from '../tool/registry';
import { Wildcard } from '../util/wildcard';
import { MCP } from '../mcp';
import { ReadTool } from '../tool/read';
import { ListTool } from '../tool/ls';
import { FileTime } from '../file/time';
import { $, fileURLToPath } from 'bun';
import { NamedError } from '../util/error';
import { SessionProcessor } from './processor';
import { Tool } from '../tool/tool';
import type { SessionPrompt } from './prompt';
type PromptInput = SessionPrompt.PromptInput;
const log = Log.create({ service: 'session.prompt' });

export async function resolveModel(input: {
  model: PromptInput['model'];
  agent: Agent.Info;
}) {
  if (input.model) {
    return input.model;
  }
  if (config.dryRun) {
    return Provider.defaultModel();
  }
  if (input.agent.model) {
    return input.agent.model;
  }
  return Provider.defaultModel();
}

export async function resolveSystemPrompt(input: {
  system?: string;
  appendSystem?: string;
  agent: Agent.Info;
  providerID: string;
  modelID: string;
}) {
  // When --system-message is provided, use it exclusively without any
  // additional context (no environment, no custom instructions, no header).
  // This is critical for models with low token limits (e.g., qwen3-32b with 6K TPM).
  //
  // Exception: For Anthropic providers using OAuth credentials, we must preserve
  // the "You are Claude Code" header when the system message doesn't contain it.
  // This header is required for OAuth token authorization.
  // See: https://github.com/link-assistant/agent/issues/62
  if (input.system !== undefined) {
    // Filter out empty strings to prevent cache_control errors
    if (input.system.trim() === '') {
      // For Anthropic providers with empty system message, preserve the OAuth header
      if (input.providerID.includes('anthropic')) {
        return SystemPrompt.header(input.providerID);
      }
      return [];
    }

    // For Anthropic providers, ensure "Claude Code" header is present
    if (input.providerID.includes('anthropic')) {
      const hasClaudeCode = input.system.includes('Claude Code');
      if (!hasClaudeCode) {
        // Prepend the OAuth header if not present
        return [...SystemPrompt.header(input.providerID), input.system];
      }
    }

    return [input.system];
  }

  let system = SystemPrompt.header(input.providerID);
  system.push(
    ...(() => {
      const base = input.agent.prompt
        ? [input.agent.prompt]
        : SystemPrompt.provider(input.modelID);
      if (input.appendSystem) {
        return [base[0] + '\n' + input.appendSystem];
      }
      return base;
    })()
  );
  system.push(...(await SystemPrompt.environment()));
  system.push(...(await SystemPrompt.custom()));

  // max 2 system prompt messages for caching purposes
  const [first, ...rest] = system;
  system = [first, rest.join('\n')];
  return system;
}

export async function resolveTools(input: {
  agent: Agent.Info;
  model: {
    providerID: string;
    modelID: string;
  };
  sessionID: string;
  tools?: Record<string, boolean>;
  processor: SessionProcessor.Info;
}) {
  const tools: Record<string, AITool> = {};
  const enabledTools = pipe(
    input.agent.tools,
    mergeDeep(
      await ToolRegistry.enabled(
        input.model.providerID,
        input.model.modelID,
        input.agent
      )
    ),
    mergeDeep(input.tools ?? {})
  );
  // Enforce read-only / planning mode and explicit --disable-tools. These
  // denials are applied last so they always win over agent and per-message
  // tool overrides (issue #271).
  for (const id of ToolRegistry.deniedTools()) {
    enabledTools[id] = false;
  }
  for (const item of await ToolRegistry.tools(
    input.model.providerID,
    input.model.modelID
  )) {
    if (Wildcard.all(item.id, enabledTools) === false) continue;
    const schema = ProviderTransform.schema(
      input.model.providerID,
      input.model.modelID,
      z.toJSONSchema(item.parameters)
    );
    tools[item.id] = tool({
      id: item.id as any,
      description: item.description,
      inputSchema: jsonSchema(schema as any),
      async execute(args, options) {
        const result = await item.execute(args, {
          sessionID: input.sessionID,
          abort: options.abortSignal!,
          messageID: input.processor.message.id,
          callID: options.toolCallId,
          extra: input.model,
          agent: input.agent.name,
          metadata: async (val) => {
            const match = input.processor.partFromToolCall(options.toolCallId);
            if (match && match.state.status === 'running') {
              await Session.updatePart({
                ...match,
                state: {
                  title: val.title,
                  metadata: val.metadata,
                  status: 'running',
                  input: args,
                  time: {
                    start: Date.now(),
                  },
                },
              });
            }
          },
        });
        return result;
      },
      toModelOutput: Tool.toModelOutput,
    });
  }

  for (const [key, item] of Object.entries(await MCP.tools())) {
    if (Wildcard.all(key, enabledTools) === false) continue;
    const execute = item.execute;
    if (!execute) continue;
    // MCP schemas go through the same provider fixes as built-in tools
    // (e.g. Moonshot/Kimi rejects `$ref` siblings and tuple `items`).
    // See: upstream 528fb1d404 (#24730) and b7b734f51f (#11984).
    const inputSchema = item.inputSchema;
    item.inputSchema = jsonSchema(async () =>
      ProviderTransform.schema(
        input.model.providerID,
        input.model.modelID,
        (await asSchema(inputSchema).jsonSchema) as any
      )
    );
    item.execute = async (args, opts) => {
      const timeout = await MCP.getToolTimeout(key);
      const result = await MCP.callWithTimeout(
        key,
        (abortSignal) => execute(args, { ...opts, abortSignal }),
        timeout,
        opts?.abortSignal
      );
      const normalized = MCP.normalizeResult(result);
      const attachments: MessageV2.FilePart[] = normalized.attachments.map(
        (attachment) => ({
          id: Identifier.ascending('part'),
          sessionID: input.sessionID,
          messageID: input.processor.message.id,
          type: 'file',
          ...attachment,
        })
      );

      return {
        title: '',
        metadata: normalized.metadata,
        output: normalized.output,
        attachments,
        content: normalized.content, // directly return content to preserve ordering when outputting to model
        isError: normalized.isError,
      };
    };
    item.toModelOutput = Tool.toModelOutput;
    tools[key] = item;
  }
  return tools;
}

export async function createUserMessage(input: PromptInput) {
  const agent = await Agent.get(input.agent ?? 'build');
  const info: MessageV2.Info = {
    id: input.messageID ?? Identifier.ascending('message'),
    role: 'user',
    sessionID: input.sessionID,
    time: {
      created: Date.now(),
    },
    tools: input.tools,
    system: input.system,
    appendSystem: input.appendSystem,
    temperature: input.temperature,
    agent: agent.name,
    model: await resolveModel({
      model: input.model,
      agent,
    }),
    compactionModel: input.compactionModel,
  };

  const parts = await Promise.all(
    input.parts.map(async (part): Promise<MessageV2.Part[]> => {
      if (part.type === 'file') {
        const url = new URL(part.url);
        switch (url.protocol) {
          case 'data:':
            if (part.mime === 'text/plain') {
              return [
                {
                  id: Identifier.ascending('part'),
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: 'text',
                  synthetic: true,
                  text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
                },
                {
                  id: Identifier.ascending('part'),
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: 'text',
                  synthetic: true,
                  text: Buffer.from(part.url, 'base64url').toString(),
                },
                {
                  ...part,
                  id: part.id ?? Identifier.ascending('part'),
                  messageID: info.id,
                  sessionID: input.sessionID,
                },
              ];
            }
            break;
          case 'file:':
            log.info(() => ({ message: 'file', mime: part.mime }));
            // have to normalize, symbol search returns absolute paths
            // Decode the pathname since URL constructor doesn't automatically decode it
            const filepath = fileURLToPath(part.url);
            const stat = await Bun.file(filepath).stat();

            if (stat.isDirectory()) {
              part.mime = 'application/x-directory';
            }

            if (part.mime === 'text/plain') {
              let offset: number | undefined = undefined;
              let limit: number | undefined = undefined;
              const range = {
                start: url.searchParams.get('start'),
                end: url.searchParams.get('end'),
              };
              if (range.start != null) {
                const filePathURI = part.url.split('?')[0];
                let start = parseInt(range.start);
                let end = range.end ? parseInt(range.end) : undefined;
                offset = Math.max(start - 1, 0);
                if (end) {
                  limit = end - offset;
                }
              }
              const args = { filePath: filepath, offset, limit };

              const pieces: MessageV2.Part[] = [
                {
                  id: Identifier.ascending('part'),
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: 'text',
                  synthetic: true,
                  text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                },
              ];

              await ReadTool.init()
                .then(async (t) => {
                  const result = await t.execute(args, {
                    sessionID: input.sessionID,
                    abort: new AbortController().signal,
                    agent: input.agent!,
                    messageID: info.id,
                    extra: { bypassCwdCheck: true, ...info.model },
                    metadata: async () => {},
                  });
                  pieces.push(
                    {
                      id: Identifier.ascending('part'),
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: 'text',
                      synthetic: true,
                      text: result.output,
                    },
                    {
                      ...part,
                      id: part.id ?? Identifier.ascending('part'),
                      messageID: info.id,
                      sessionID: input.sessionID,
                    }
                  );
                })
                .catch((error) => {
                  log.error(() => ({
                    message: 'failed to read file',
                    error,
                  }));
                  const message =
                    error instanceof Error ? error.message : error.toString();
                  Bus.publish(Session.Event.Error, {
                    sessionID: input.sessionID,
                    error: new NamedError.Unknown({
                      message,
                    }).toObject(),
                  });
                  pieces.push({
                    id: Identifier.ascending('part'),
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: 'text',
                    synthetic: true,
                    text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                  });
                });

              return pieces;
            }

            if (part.mime === 'application/x-directory') {
              const args = { path: filepath };
              const result = await ListTool.init().then((t) =>
                t.execute(args, {
                  sessionID: input.sessionID,
                  abort: new AbortController().signal,
                  agent: input.agent!,
                  messageID: info.id,
                  extra: { bypassCwdCheck: true },
                  metadata: async () => {},
                })
              );
              return [
                {
                  id: Identifier.ascending('part'),
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: 'text',
                  synthetic: true,
                  text: `Called the list tool with the following input: ${JSON.stringify(args)}`,
                },
                {
                  id: Identifier.ascending('part'),
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: 'text',
                  synthetic: true,
                  text: result.output,
                },
                {
                  ...part,
                  id: part.id ?? Identifier.ascending('part'),
                  messageID: info.id,
                  sessionID: input.sessionID,
                },
              ];
            }

            const file = Bun.file(filepath);
            FileTime.read(input.sessionID, filepath);
            return [
              {
                id: Identifier.ascending('part'),
                messageID: info.id,
                sessionID: input.sessionID,
                type: 'text',
                text: `Called the Read tool with the following input: {\"filePath\":\"${filepath}\"}`,
                synthetic: true,
              },
              {
                id: part.id ?? Identifier.ascending('part'),
                messageID: info.id,
                sessionID: input.sessionID,
                type: 'file',
                url:
                  `data:${part.mime};base64,` +
                  Buffer.from(await file.bytes()).toString('base64'),
                mime: part.mime,
                filename: part.filename!,
                source: part.source,
              },
            ];
        }
      }

      if (part.type === 'agent') {
        return [
          {
            id: Identifier.ascending('part'),
            ...part,
            messageID: info.id,
            sessionID: input.sessionID,
          },
          {
            id: Identifier.ascending('part'),
            messageID: info.id,
            sessionID: input.sessionID,
            type: 'text',
            synthetic: true,
            text:
              'Use the above message and context to generate a prompt and call the task tool with subagent: ' +
              part.name,
          },
        ];
      }

      return [
        {
          id: Identifier.ascending('part'),
          ...part,
          messageID: info.id,
          sessionID: input.sessionID,
        },
      ];
    })
  ).then((x) => x.flat());

  await Session.updateMessage(info);
  for (const part of parts) {
    await Session.updatePart(part);
  }

  return {
    info,
    parts,
  };
}

export function insertReminders(input: {
  messages: MessageV2.WithParts[];
  agent: Agent.Info;
}) {
  const userMessage = input.messages.findLast(
    (msg) => msg.info.role === 'user'
  );
  if (!userMessage) return input.messages;
  if (input.agent.name === 'plan') {
    userMessage.parts.push({
      id: Identifier.ascending('part'),
      messageID: userMessage.info.id,
      sessionID: userMessage.info.sessionID,
      type: 'text',
      text: PROMPT_PLAN,
      synthetic: true,
    });
  }
  const wasPlan = input.messages.some(
    (msg) => msg.info.role === 'assistant' && msg.info.mode === 'plan'
  );
  if (wasPlan && input.agent.name === 'build') {
    userMessage.parts.push({
      id: Identifier.ascending('part'),
      messageID: userMessage.info.id,
      sessionID: userMessage.info.sessionID,
      type: 'text',
      text: BUILD_SWITCH,
      synthetic: true,
    });
  }
  return input.messages;
}

// Title generation is optional and disabled by default to save tokens
// Enable via --generate-title flag or AGENT_GENERATE_TITLE=true env var
// See: https://github.com/link-assistant/agent/issues/157
export async function ensureTitle(input: {
  session: Session.Info;
  message: MessageV2.WithParts;
  history: MessageV2.WithParts[];
  providerID: string;
  modelID: string;
}) {
  // Skip title generation if disabled (default)
  if (!config.generateTitle) {
    log.info(() => ({
      message: 'title generation disabled',
      hint: 'Enable with --generate-title flag or AGENT_GENERATE_TITLE=true',
    }));
    return;
  }
  if (input.session.parentID) return;
  if (!Session.isDefaultTitle(input.session.title)) return;
  const isFirst =
    input.history.filter(
      (m) =>
        m.info.role === 'user' &&
        !m.parts.every((p) => 'synthetic' in p && p.synthetic)
    ).length === 1;
  if (!isFirst) return;
  const small =
    (await Provider.getSmallModel(input.providerID)) ??
    (await Provider.getModel(input.providerID, input.modelID));
  const options = {
    ...ProviderTransform.options(
      small.providerID,
      small.modelID,
      small.npm ?? '',
      input.session.id
    ),
    ...(small.info?.options ?? {}),
  };
  if (small.providerID === 'openai' || small.modelID.includes('gpt-5')) {
    if (small.modelID.includes('5.1')) {
      options['reasoningEffort'] = 'low';
    } else {
      options['reasoningEffort'] = 'minimal';
    }
  }
  if (small.providerID === 'google') {
    options['thinkingConfig'] = {
      thinkingBudget: 0,
    };
  }
  // Pre-convert messages to ModelMessage format (async in AI SDK 6.0+)
  const titleModelMessages = await MessageV2.toModelMessage([
    {
      info: {
        id: Identifier.ascending('message'),
        role: 'user',
        sessionID: input.session.id,
        time: {
          created: Date.now(),
        },
        agent:
          input.message.info.role === 'user'
            ? input.message.info.agent
            : 'build',
        model: {
          providerID: input.providerID,
          modelID: input.modelID,
        },
      },
      parts: input.message.parts,
    },
  ]);
  // Defensive check: ensure titleModelMessages is iterable (AI SDK 6.0.1 compatibility fix)
  const safeTitleMessages = Array.isArray(titleModelMessages)
    ? titleModelMessages
    : [];
  // Defensive check: ensure SystemPrompt.title returns iterable (fix for issue #155)
  const titleSystemMessages = SystemPrompt.title(small.providerID);
  const safeTitleSystemMessages = Array.isArray(titleSystemMessages)
    ? titleSystemMessages
    : [];
  await generateText({
    maxOutputTokens: small.info?.reasoning ? 1500 : 20,
    providerOptions: ProviderTransform.providerOptions(
      small.npm,
      small.providerID,
      options
    ),
    instructions: safeTitleSystemMessages.map((content) => ({
      role: 'system',
      content,
    })),
    messages: [
      {
        role: 'user' as const,
        content: `
            The following is the text to summarize:
          `,
      },
      ...safeTitleMessages,
    ],
    headers: small.info?.headers ?? {},
    model: small.language,
  })
    .then((result) => {
      if (result.text)
        return Session.update(input.session.id, (draft) => {
          const cleaned = result.text
            .replace(/<think>[\s\S]*?<\/think>\s*/g, '')
            .split('\n')
            .map((line) => line.trim())
            .find((line) => line.length > 0);
          if (!cleaned) return;

          const title =
            cleaned.length > 100 ? cleaned.substring(0, 97) + '...' : cleaned;
          draft.title = title;
        });
    })
    .catch((error) => {
      log.error(() => ({
        message: 'failed to generate title',
        error,
        model: small.info?.id ?? small.modelID,
      }));
    });
}
