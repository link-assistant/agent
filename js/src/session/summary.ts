import { Provider } from '../provider/provider';
import { fn } from '../util/fn';
import z from 'zod';
import { Session } from '.';
import { generateText, type ModelMessage } from 'ai';
import { MessageV2 } from './message-v2';
import { Identifier } from '../id/id';
import { Snapshot } from '../snapshot';
import { ProviderTransform } from '../provider/transform';
import { SystemPrompt } from './system';
import { Log } from '../util/log';
import path from 'path';
import { Instance } from '../project/instance';
import { Storage } from '../storage/storage';
import { Bus } from '../bus';
import { Flag } from '../flag/flag';
import { Token } from '../util/token';

export namespace SessionSummary {
  const log = Log.create({ service: 'session.summary' });

  export const summarize = fn(
    z.object({
      sessionID: z.string(),
      messageID: z.string(),
    }),
    async (input) => {
      const all = await Session.messages({ sessionID: input.sessionID });
      await Promise.all([
        summarizeSession({ sessionID: input.sessionID, messages: all }),
        summarizeMessage({ messageID: input.messageID, messages: all }),
      ]);
    }
  );

  async function summarizeSession(input: {
    sessionID: string;
    messages: MessageV2.WithParts[];
  }) {
    const files = new Set(
      input.messages
        .flatMap((x) => x.parts)
        .filter((x) => x.type === 'patch')
        .flatMap((x) => x.files)
        .map((x) => path.relative(Instance.worktree, x))
    );
    const diffs = await computeDiff({ messages: input.messages }).then((x) =>
      x.filter((x) => {
        return files.has(x.file);
      })
    );
    await Session.update(input.sessionID, (draft) => {
      draft.summary = {
        additions: diffs.reduce((sum, x) => sum + x.additions, 0),
        deletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
        files: diffs.length,
      };
    });
    await Storage.write(['session_diff', input.sessionID], diffs);
    Bus.publish(Session.Event.Diff, {
      sessionID: input.sessionID,
      diff: diffs,
    });
  }

  async function summarizeMessage(input: {
    messageID: string;
    messages: MessageV2.WithParts[];
  }) {
    const messages = input.messages.filter(
      (m) =>
        m.info.id === input.messageID ||
        (m.info.role === 'assistant' && m.info.parentID === input.messageID)
    );
    const msgWithParts = messages.find((m) => m.info.id === input.messageID)!;
    const userMsg = msgWithParts.info as MessageV2.User;
    const diffs = await computeDiff({ messages });
    userMsg.summary = {
      ...userMsg.summary,
      diffs,
    };
    await Session.updateMessage(userMsg);

    // Skip AI-powered summarization if disabled
    // See: https://github.com/link-assistant/agent/issues/217
    if (!Flag.SUMMARIZE_SESSION) {
      log.info(() => ({
        message: 'session summarization disabled',
        hint: 'Enable with --summarize-session flag (enabled by default) or AGENT_SUMMARIZE_SESSION=true',
      }));
      return;
    }

    const assistantMsg = messages.find((m) => m.info.role === 'assistant')!
      .info as MessageV2.Assistant;

    // Use the same model as the main session (--model) instead of a small model
    // This ensures consistent behavior and uses the model the user explicitly requested
    // See: https://github.com/link-assistant/agent/issues/217
    log.info(() => ({
      message: 'loading model for summarization',
      providerID: assistantMsg.providerID,
      modelID: assistantMsg.modelID,
      hint: 'Using same model as --model (not a small model)',
    }));
    const model = await Provider.getModel(
      assistantMsg.providerID,
      assistantMsg.modelID
    ).catch(() => null);
    if (!model) {
      log.info(() => ({
        message: 'could not load session model for summarization, skipping',
        providerID: assistantMsg.providerID,
        modelID: assistantMsg.modelID,
      }));
      return;
    }

    if (Flag.OPENCODE_VERBOSE) {
      log.info(() => ({
        message: 'summarization model loaded',
        providerID: model.providerID,
        modelID: model.modelID,
        npm: model.npm,
        contextLimit: model.info.limit.context,
        outputLimit: model.info.limit.output,
        reasoning: model.info.reasoning,
        toolCall: model.info.tool_call,
      }));
    }

    const textPart = msgWithParts.parts.find(
      (p) => p.type === 'text' && !p.synthetic
    ) as MessageV2.TextPart;
    if (textPart && !userMsg.summary?.title) {
      const titleMaxTokens = model.info.reasoning ? 1500 : 20;
      const systemPrompts = SystemPrompt.title(model.providerID);
      const userContent = `
              The following is the text to summarize:
              <text>
              ${textPart?.text ?? ''}
              </text>
            `;

      if (Flag.OPENCODE_VERBOSE) {
        log.info(() => ({
          message: 'generating title via API',
          providerID: model.providerID,
          modelID: model.modelID,
          maxOutputTokens: titleMaxTokens,
          systemPromptCount: systemPrompts.length,
          userContentLength: userContent.length,
          userContentTokenEstimate: Token.estimate(userContent),
          userContentPreview: userContent.substring(0, 500),
        }));
      }

      const result = await generateText({
        maxOutputTokens: titleMaxTokens,
        providerOptions: ProviderTransform.providerOptions(
          model.npm,
          model.providerID,
          {}
        ),
        messages: [
          ...systemPrompts.map(
            (x): ModelMessage => ({
              role: 'system',
              content: x,
            })
          ),
          {
            role: 'user' as const,
            content: userContent,
          },
        ],
        headers: model.info.headers,
        model: model.language,
      });

      if (Flag.OPENCODE_VERBOSE) {
        log.info(() => ({
          message: 'title API response received',
          providerID: model.providerID,
          modelID: model.modelID,
          titleLength: result.text.length,
          usage: result.usage,
        }));
      }
      log.info(() => ({ message: 'title', title: result.text }));
      userMsg.summary.title = result.text;
      await Session.updateMessage(userMsg);
    }

    if (
      messages.some(
        (m) =>
          m.info.role === 'assistant' &&
          m.parts.some(
            (p) => p.type === 'step-finish' && p.reason !== 'tool-calls'
          )
      )
    ) {
      let summary = messages
        .findLast((m) => m.info.role === 'assistant')
        ?.parts.findLast((p) => p.type === 'text')?.text;
      if (!summary || diffs.length > 0) {
        // Pre-convert messages to ModelMessage format (async in AI SDK 6.0+)
        const modelMessages = await MessageV2.toModelMessage(messages);
        const conversationContent = JSON.stringify(modelMessages);

        if (Flag.OPENCODE_VERBOSE) {
          log.info(() => ({
            message: 'generating body summary via API',
            providerID: model.providerID,
            modelID: model.modelID,
            maxOutputTokens: 100,
            conversationLength: conversationContent.length,
            conversationTokenEstimate: Token.estimate(conversationContent),
            messageCount: modelMessages.length,
            diffsCount: diffs.length,
            hasPriorSummary: !!summary,
          }));
        }

        const result = await generateText({
          model: model.language,
          maxOutputTokens: 100,
          messages: [
            {
              role: 'user',
              content: `
            Summarize the following conversation into 2 sentences MAX explaining what the assistant did and why. Do not explain the user's input. Do not speak in the third person about the assistant.
            <conversation>
            ${conversationContent}
            </conversation>
            `,
            },
          ],
          headers: model.info.headers,
        }).catch((err) => {
          if (Flag.OPENCODE_VERBOSE) {
            log.warn(() => ({
              message: 'body summary API call failed',
              providerID: model.providerID,
              modelID: model.modelID,
              error: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack : undefined,
            }));
          }
          return undefined;
        });
        if (result) {
          if (Flag.OPENCODE_VERBOSE) {
            log.info(() => ({
              message: 'body summary API response received',
              providerID: model.providerID,
              modelID: model.modelID,
              summaryLength: result.text.length,
              usage: result.usage,
            }));
          }
          summary = result.text;
        }
      }
      userMsg.summary.body = summary;
      log.info(() => ({ message: 'body', body: summary }));
      await Session.updateMessage(userMsg);
    }
  }

  export const diff = fn(
    z.object({
      sessionID: Identifier.schema('session'),
      messageID: Identifier.schema('message').optional(),
    }),
    async (input) => {
      return Storage.read<Snapshot.FileDiff[]>([
        'session_diff',
        input.sessionID,
      ]).catch(() => []);
    }
  );

  async function computeDiff(input: { messages: MessageV2.WithParts[] }) {
    let from: string | undefined;
    let to: string | undefined;

    // scan assistant messages to find earliest from and latest to
    // snapshot
    for (const item of input.messages) {
      if (!from) {
        for (const part of item.parts) {
          if (part.type === 'step-start' && part.snapshot) {
            from = part.snapshot;
            break;
          }
        }
      }

      for (const part of item.parts) {
        if (part.type === 'step-finish' && part.snapshot) {
          to = part.snapshot;
          break;
        }
      }
    }

    if (from && to) return Snapshot.diffFull(from, to);
    return [];
  }
}
