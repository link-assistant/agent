/**
 * Permission system (issue #271).
 *
 * Re-adds an OpenCode-style permission system to @link-assistant/agent that is
 * fully controllable from JSON (input and output), with no TUI.
 *
 * By default the agent runs in **full auto mode** (every action is `allow`), so
 * nothing changes for existing consumers. Opt-in CLI options switch the policy:
 *
 *   --permission-mode auto      (default) allow everything, never ask
 *   --permission-mode plan      read-only planning: deny edits, allow read-only
 *                               shell commands, ask before anything else
 *   --permission-mode readonly  hard read-only: deny edits and any non
 *                               read-only shell command (never asks)
 *   --permission-mode ask       ask before every mutating tool (per-command
 *                               approval driven over JSON)
 *   --permission '<json>'       explicit OpenCode-compatible override merged on
 *                               top of the mode, e.g.
 *                               '{"bash":{"git push*":"ask","*":"allow"},"edit":"ask"}'
 *
 * When a tool needs approval it publishes a `permission.updated` event (emitted
 * to stdout as a `permission_request` JSON event) and waits. The consumer sends
 * back a `permission_response` JSON frame which resolves `Permission.respond`.
 *
 * This is the native, enforceable counterpart of agent-commander's `--read-only`
 * flag and of its (future) per-command approval UX.
 */
import z from 'zod';
import { Bus } from '../bus';
import { Log } from '../util/log';
import { Identifier } from '../id/id';
import { Instance } from '../project/instance';
import { Wildcard } from '../util/wildcard';
import { config } from '../config/config';

export namespace Permission {
  const log = Log.create({ service: 'permission' });

  // ─── Policy types ─────────────────────────────────────────────────────────

  export const Action = z.enum(['ask', 'allow', 'deny']);
  export type Action = z.infer<typeof Action>;

  export const Mode = z.enum(['auto', 'plan', 'readonly', 'ask']);
  export type Mode = z.infer<typeof Mode>;

  /** Resolved permission policy. `bash` is a pattern map (OpenCode-compatible). */
  export interface Policy {
    edit: Action;
    bash: Record<string, Action>;
    webfetch: Action;
  }

  /**
   * Read-only shell allowlist. Commands matching one of these patterns are safe
   * to run in plan/readonly mode; everything else falls back to `fallback`
   * (`ask` for plan, `deny` for readonly).
   */
  function readonlyBash(fallback: Action): Record<string, Action> {
    return {
      'cat*': 'allow',
      'cd*': 'allow',
      'cut*': 'allow',
      'date*': 'allow',
      'df*': 'allow',
      'diff*': 'allow',
      'dirname*': 'allow',
      'du*': 'allow',
      'echo*': 'allow',
      env: 'allow',
      'file *': 'allow',
      'find *': 'allow',
      'git diff*': 'allow',
      'git log*': 'allow',
      'git show*': 'allow',
      'git status*': 'allow',
      'git branch': 'allow',
      'git branch -v': 'allow',
      'grep*': 'allow',
      'head*': 'allow',
      'hostname*': 'allow',
      'less*': 'allow',
      'ls*': 'allow',
      'more*': 'allow',
      'printenv*': 'allow',
      'pwd*': 'allow',
      'readlink*': 'allow',
      'realpath*': 'allow',
      'rg*': 'allow',
      'sort*': 'allow',
      'stat*': 'allow',
      'tail*': 'allow',
      'tree*': 'allow',
      'uname*': 'allow',
      'uniq*': 'allow',
      'wc*': 'allow',
      'whereis*': 'allow',
      'which*': 'allow',
      'whoami*': 'allow',
      // Read-only command families that have destructive variants:
      'find * -delete*': fallback,
      'find * -exec*': fallback,
      'find * -execdir*': fallback,
      'find * -fprint*': fallback,
      'find * -fls*': fallback,
      'find * -fprintf*': fallback,
      'find * -ok*': fallback,
      'sort -o*': fallback,
      'sort --output*': fallback,
      'tree -o*': fallback,
      // Catch-all:
      '*': fallback,
    };
  }

  /** Base policy for a mode, before any explicit `--permission` override. */
  export function modePolicy(mode: Mode): Policy {
    switch (mode) {
      case 'plan':
        return { edit: 'deny', bash: readonlyBash('ask'), webfetch: 'allow' };
      case 'readonly':
        return { edit: 'deny', bash: readonlyBash('deny'), webfetch: 'allow' };
      case 'ask':
        return { edit: 'ask', bash: { '*': 'ask' }, webfetch: 'ask' };
      case 'auto':
      default:
        return { edit: 'allow', bash: { '*': 'allow' }, webfetch: 'allow' };
    }
  }

  /** Parse the raw `--permission` JSON string into a partial policy. */
  export function parseOverride(raw: string | undefined): Partial<Policy> {
    if (!raw || !raw.trim()) return {};
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `Invalid --permission JSON: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid --permission JSON: expected an object');
    }
    const out: Partial<Policy> = {};
    if (parsed.edit !== undefined) out.edit = Action.parse(parsed.edit);
    if (parsed.webfetch !== undefined)
      out.webfetch = Action.parse(parsed.webfetch);
    if (parsed.bash !== undefined) {
      if (typeof parsed.bash === 'string') {
        out.bash = { '*': Action.parse(parsed.bash) };
      } else if (
        typeof parsed.bash === 'object' &&
        !Array.isArray(parsed.bash)
      ) {
        const bash: Record<string, Action> = {};
        for (const [pattern, value] of Object.entries(parsed.bash)) {
          bash[pattern] = Action.parse(value);
        }
        out.bash = bash;
      } else {
        throw new Error(
          'Invalid --permission JSON: "bash" must be a string or object'
        );
      }
    }
    return out;
  }

  /**
   * Resolve the active policy from the global config. Mode defines the base
   * policy and `--permission` JSON is merged on top (override wins; bash maps
   * are merged key-by-key).
   */
  export function policy(): Policy {
    const mode = Mode.parse(config.permissionMode ?? 'auto');
    const base = modePolicy(mode);
    const override = parseOverride(config.permission);
    return {
      edit: override.edit ?? base.edit,
      webfetch: override.webfetch ?? base.webfetch,
      bash: { ...base.bash, ...(override.bash ?? {}) },
    };
  }

  const RESTRICTIVENESS: Record<Action, number> = {
    allow: 0,
    ask: 1,
    deny: 2,
  };

  function moreRestrictive(a: Action, b: Action): Action {
    return RESTRICTIVENESS[b] > RESTRICTIVENESS[a] ? b : a;
  }

  function tokenize(segment: string): string[] {
    return segment.trim().split(/\s+/).filter(Boolean);
  }

  /**
   * Evaluate a shell command against a bash pattern map.
   *
   * Faithful-enough port of OpenCode's structured matching, hardened for
   * non-interactive enforcement: a command is only `allow`ed when *every*
   * segment (split on `;`, `&&`, `||`, `|`) matches an allow pattern and the
   * command contains no command substitution or output redirection. Otherwise
   * it falls back to the catch-all action (`*`). The strongest enforcement
   * remains tool removal via `--read-only` / `--disable-tools`.
   */
  export function evaluateBash(
    command: string,
    patterns: Record<string, Action>
  ): { action: Action; askPatterns: string[] } {
    const fallback = patterns['*'] ?? 'allow';
    const askPatterns = new Set<string>();

    // Command substitution or output redirection can hide arbitrary writes.
    const hasSubstitution = /\$\(|`/.test(command);
    const hasRedirection = />>?/.test(command);
    if (hasSubstitution || hasRedirection) {
      if (fallback === 'ask') askPatterns.add(command);
      return { action: fallback, askPatterns: Array.from(askPatterns) };
    }

    const segments = command
      .split(/&&|\|\||;|\|/g)
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length === 0) {
      return { action: fallback, askPatterns: [] };
    }

    let action: Action = 'allow';
    for (const segment of segments) {
      const tokens = tokenize(segment);
      if (tokens.length === 0) continue;
      const matched = Wildcard.allStructured(
        { head: tokens[0], tail: tokens.slice(1) },
        patterns
      ) as Action | undefined;
      const segAction = matched ?? fallback;
      action = moreRestrictive(action, segAction);
      if (segAction === 'ask') {
        const sub = tokens.slice(1).find((arg) => !arg.startsWith('-'));
        askPatterns.add(sub ? `${tokens[0]} ${sub} *` : `${tokens[0]} *`);
      }
    }
    return { action, askPatterns: Array.from(askPatterns) };
  }

  // ─── Ask / respond machinery (ported from OpenCode) ───────────────────────

  function toKeys(pattern: Info['pattern'], type: string): string[] {
    return pattern === undefined
      ? [type]
      : Array.isArray(pattern)
        ? pattern
        : [pattern];
  }

  function covered(keys: string[], approved: Record<string, boolean>): boolean {
    const pats = Object.keys(approved);
    return keys.every((k) => pats.some((p) => Wildcard.match(k, p)));
  }

  export const Info = z
    .object({
      id: z.string(),
      type: z.string(),
      pattern: z.union([z.string(), z.array(z.string())]).optional(),
      sessionID: z.string(),
      messageID: z.string(),
      callID: z.string().optional(),
      title: z.string(),
      metadata: z.record(z.string(), z.any()),
      time: z.object({
        created: z.number(),
      }),
    })
    .meta({
      ref: 'Permission',
    });
  export type Info = z.infer<typeof Info>;

  export const Event = {
    Updated: Bus.event('permission.updated', Info),
    Replied: Bus.event(
      'permission.replied',
      z.object({
        sessionID: z.string(),
        permissionID: z.string(),
        response: z.string(),
      })
    ),
  };

  const state = Instance.state(
    () => {
      const pending: {
        [sessionID: string]: {
          [permissionID: string]: {
            info: Info;
            resolve: () => void;
            reject: (e: any) => void;
          };
        };
      } = {};

      const approved: {
        [sessionID: string]: {
          [permissionID: string]: boolean;
        };
      } = {};

      return {
        pending,
        approved,
      };
    },
    async (state) => {
      for (const pending of Object.values(state.pending)) {
        for (const item of Object.values(pending)) {
          item.reject(
            new RejectedError(
              item.info.sessionID,
              item.info.id,
              item.info.callID,
              item.info.metadata
            )
          );
        }
      }
    }
  );

  export function pending() {
    return state().pending;
  }

  export const Response = z.enum(['once', 'always', 'reject']);
  export type Response = z.infer<typeof Response>;

  /**
   * Ask for permission. Resolves immediately when already approved; rejects
   * (throws via the caller) when denied. Otherwise registers a pending request,
   * publishes `permission.updated`, and returns a promise resolved by
   * `respond()`.
   */
  export async function ask(input: {
    type: Info['type'];
    title: Info['title'];
    pattern?: Info['pattern'];
    callID?: Info['callID'];
    sessionID: Info['sessionID'];
    messageID: Info['messageID'];
    metadata: Info['metadata'];
  }) {
    const { pending, approved } = state();
    log.info(() => ({
      message: 'asking',
      sessionID: input.sessionID,
      pattern: input.pattern,
    }));
    const approvedForSession = approved[input.sessionID] || {};
    const keys = toKeys(input.pattern, input.type);
    if (covered(keys, approvedForSession)) return;
    const info: Info = {
      id: Identifier.ascending('permission'),
      type: input.type,
      pattern: input.pattern,
      sessionID: input.sessionID,
      messageID: input.messageID,
      callID: input.callID,
      title: input.title,
      metadata: input.metadata,
      time: {
        created: Date.now(),
      },
    };

    pending[input.sessionID] = pending[input.sessionID] || {};
    return new Promise<void>((resolve, reject) => {
      pending[input.sessionID][info.id] = {
        info,
        resolve,
        reject,
      };
      Bus.publish(Event.Updated, info);
    });
  }

  /**
   * Rejects and drops the pending asks of a session. Called when its turn is
   * cancelled, so an aborted turn does not leave a pending promise (and its
   * tool call) behind until the instance is disposed (issue #335).
   */
  export function clearSession(sessionID: Info['sessionID']) {
    const { pending } = state();
    const items = pending[sessionID];
    if (!items) return;
    delete pending[sessionID];
    for (const item of Object.values(items)) {
      item.reject(
        new RejectedError(
          item.info.sessionID,
          item.info.id,
          item.info.callID,
          item.info.metadata
        )
      );
    }
  }

  export function respond(input: {
    sessionID: Info['sessionID'];
    permissionID: Info['id'];
    response: Response;
  }) {
    log.info(() => ({ message: 'response', ...input }));
    const { pending, approved } = state();
    const match = pending[input.sessionID]?.[input.permissionID];
    if (!match) return;
    delete pending[input.sessionID][input.permissionID];
    Bus.publish(Event.Replied, {
      sessionID: input.sessionID,
      permissionID: input.permissionID,
      response: input.response,
    });
    if (input.response === 'reject') {
      match.reject(
        new RejectedError(
          input.sessionID,
          input.permissionID,
          match.info.callID,
          match.info.metadata
        )
      );
      return;
    }
    match.resolve();
    if (input.response === 'always') {
      approved[input.sessionID] = approved[input.sessionID] || {};
      const approveKeys = toKeys(match.info.pattern, match.info.type);
      for (const k of approveKeys) {
        approved[input.sessionID][k] = true;
      }
      const items = pending[input.sessionID];
      if (!items) return;
      for (const item of Object.values(items)) {
        const itemKeys = toKeys(item.info.pattern, item.info.type);
        if (covered(itemKeys, approved[input.sessionID])) {
          respond({
            sessionID: item.info.sessionID,
            permissionID: item.info.id,
            response: input.response,
          });
        }
      }
    }
  }

  export class RejectedError extends Error {
    constructor(
      public readonly sessionID: string,
      public readonly permissionID: string,
      public readonly toolCallID?: string,
      public readonly metadata?: Record<string, any>,
      public readonly reason?: string
    ) {
      super(
        reason !== undefined
          ? reason
          : `The user rejected permission to use this specific tool call. You may try again with different parameters.`
      );
    }
  }

  // ─── High-level helpers used by tools ─────────────────────────────────────

  /**
   * Enforce the policy for a simple (non-bash) tool type (`edit`/`webfetch`).
   * Throws RejectedError on deny, asks (and may throw) on ask, returns on allow.
   */
  export async function check(input: {
    type: 'edit' | 'webfetch';
    title: string;
    sessionID: string;
    messageID: string;
    callID?: string;
    metadata?: Record<string, any>;
  }) {
    const p = policy();
    const action: Action = input.type === 'edit' ? p.edit : p.webfetch;
    if (action === 'allow') return;
    if (action === 'deny') {
      throw new RejectedError(
        input.sessionID,
        input.callID ?? input.messageID,
        input.callID,
        input.metadata,
        `The ${input.type} tool is disabled in the current permission mode (${config.permissionMode ?? 'auto'}).`
      );
    }
    await ask({
      type: input.type,
      title: input.title,
      sessionID: input.sessionID,
      messageID: input.messageID,
      callID: input.callID,
      metadata: input.metadata ?? {},
    });
  }

  /**
   * Whether bash enforcement is active. In the default `auto` mode every
   * pattern maps to `allow`, so callers can skip the (non-trivial) tree-sitter
   * parse entirely — preserving zero overhead for the full-auto default.
   */
  export function bashEnforced(): boolean {
    const patterns = policy().bash;
    return Object.values(patterns).some((a) => a !== 'allow');
  }

  /** Resolve the ask-pattern for a single command's token array. */
  function askPattern(command: string[]): string {
    const head = command[0];
    const sub = command.slice(1).find((arg) => !arg.startsWith('-'));
    return sub ? `${head} ${sub} *` : `${head} *`;
  }

  /**
   * Enforce the bash policy for the extracted command nodes of a shell line.
   *
   * `commands` is the list of token arrays for every `command` node parsed out
   * of the shell line (e.g. via tree-sitter), so command substitutions and
   * chained commands are each evaluated independently — faithful to OpenCode's
   * bash tool. `cd` is always allowed. A `deny` match throws `RejectedError`; any
   * `ask` matches are batched into a single `Permission.ask`.
   */
  export async function checkBashTokens(input: {
    commands: string[][];
    command: string;
    sessionID: string;
    messageID: string;
    callID?: string;
  }) {
    const patterns = policy().bash;
    const askPatterns = new Set<string>();
    for (const command of input.commands) {
      if (command.length === 0) continue;
      if (command[0] === 'cd') continue;
      const action = Wildcard.allStructured(
        { head: command[0], tail: command.slice(1) },
        patterns
      ) as Action | undefined;
      if (action === 'deny') {
        throw new RejectedError(
          input.sessionID,
          input.callID ?? input.messageID,
          input.callID,
          { command: input.command },
          `The command "${command[0]}" is not allowed in the current permission mode (${config.permissionMode ?? 'auto'}). Configuration: ${JSON.stringify(
            patterns
          )}`
        );
      }
      if (action === 'ask') {
        askPatterns.add(askPattern(command));
      }
    }
    if (askPatterns.size > 0) {
      const list = Array.from(askPatterns);
      await ask({
        type: 'bash',
        pattern: list,
        sessionID: input.sessionID,
        messageID: input.messageID,
        callID: input.callID,
        title: input.command,
        metadata: { command: input.command, patterns: list },
      });
    }
  }
}
