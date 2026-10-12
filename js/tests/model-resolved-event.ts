import { describe, expect, test } from 'bun:test';

import {
  MODEL_RESOLVED_EVENT_TYPE,
  buildModelResolvedEvent,
  selectorMatchesModel,
} from '../src/cli/model-resolution';

/**
 * Tests for the `model_resolved` routing attestation.
 *
 * Issue #295: expose model routing as a stable machine-readable event instead of
 * an English log message. A consumer must be able to switch on `type` and read
 * `providerID`/`modelID`/`source`/`matchesRequest` without matching prose.
 *
 * The child-process cases below drive the real `parseModelConfig`, so they cover
 * every resolution path end to end: explicit `provider/model`, bare model id and
 * the built-in default.
 *
 * @see https://github.com/link-assistant/agent/issues/295
 */

interface ModelResolvedLike {
  type: string;
  requested: string | null;
  selector: string;
  providerID: string;
  modelID: string;
  source: string;
  matchesRequest: boolean;
  timestamp: string;
}

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  events: ModelResolvedLike[];
  lines: Record<string, unknown>[];
}

/**
 * Run `parseModelConfig` in a child process and collect the JSON it printed.
 *
 * A child process is required because the attestation is written to the real
 * stdout of the process that resolves the model.
 */
async function runParseModelConfig(options: {
  /** `--model` value; omit entirely to exercise the default path. */
  selector?: string;
  /** Extra argv keys handed to `parseModelConfig`. */
  argv?: Record<string, unknown>;
  env?: Record<string, string>;
}): Promise<RunResult> {
  const { selector, argv = {}, env = {} } = options;
  const argvObject = {
    ...(selector === undefined ? {} : { model: selector }),
    'compaction-models': '(same)',
    ...argv,
  };
  const processArgv =
    selector === undefined
      ? ['bun', 'agent']
      : ['bun', 'agent', '--model', selector];

  const script = `
    import { parseModelConfig } from './src/cli/model-config.js';
    import { initConfig, resetConfig } from './src/config/config.ts';
    import { Instance } from './src/project/instance.ts';

    process.argv = ${JSON.stringify(processArgv)};
    resetConfig();
    initConfig(process.argv);

    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const parsed = await parseModelConfig(
          ${JSON.stringify(argvObject)},
          () => {},
          () => {},
          { defaultCompactionModels: '(same)' }
        );
        process.stderr.write(
          'RESULT ' +
            JSON.stringify({
              providerID: parsed.providerID,
              modelID: parsed.modelID,
            }) +
            '\\n'
        );
      },
    });

    await Instance.disposeAll();
  `;

  const childEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
    FORMAL_AI_API_KEY: 'local-test-token',
    FORMAL_AI_BASE_URL: 'http://127.0.0.1:18080/api/openai/v1',
    LINK_ASSISTANT_AGENT_CONFIG_CONTENT: '{}',
    LINK_ASSISTANT_AGENT_DEFAULT_COMPACTION_MODELS: '(same)',
  };
  // Never inherit an operator override: it would turn `source: "default"` into
  // `source: "config"` and mask a regression.
  delete childEnv.LINK_ASSISTANT_AGENT_DEFAULT_MODEL;
  Object.assign(childEnv, env);

  const proc = Bun.spawn({
    cmd: ['bun', '--eval', script],
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
    env: childEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  const lines = stdout
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((value): value is Record<string, unknown> => value !== null);

  return {
    stdout,
    stderr,
    exitCode,
    lines,
    events: lines.filter(
      (line) => line.type === MODEL_RESOLVED_EVENT_TYPE
    ) as unknown as ModelResolvedLike[],
  };
}

function expectSuccess(result: RunResult): void {
  if (result.exitCode !== 0) {
    throw new Error(
      `parseModelConfig exited with ${result.exitCode}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
    );
  }
}

describe('model_resolved contract', () => {
  test('the event type string is part of the machine contract', () => {
    // Guards the contract itself: a reword of the human-readable
    // "using explicit provider/model" log must not be able to change this.
    expect(MODEL_RESOLVED_EVENT_TYPE).toBe('model_resolved');
    const event = buildModelResolvedEvent({
      requested: 'formalai/formal-ai',
      selector: 'formalai/formal-ai',
      providerID: 'formalai',
      modelID: 'formal-ai',
      source: 'cli',
    });
    expect(event.type).toBe('model_resolved');
  });

  test('carries the full routing payload', () => {
    const event = buildModelResolvedEvent({
      requested: 'formalai/formal-ai',
      selector: 'formalai/formal-ai',
      providerID: 'formalai',
      modelID: 'formal-ai',
      source: 'cli',
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    expect(event).toEqual({
      type: 'model_resolved',
      timestamp: '2026-01-01T00:00:00.000Z',
      requested: 'formalai/formal-ai',
      selector: 'formalai/formal-ai',
      providerID: 'formalai',
      modelID: 'formal-ai',
      source: 'cli',
      matchesRequest: true,
    });
  });

  test('requested is null when nothing was requested', () => {
    const event = buildModelResolvedEvent({
      requested: null,
      selector: 'opencode/minimax-m2.5-free',
      providerID: 'opencode',
      modelID: 'minimax-m2.5-free',
      source: 'default',
    });

    expect(event.requested).toBeNull();
    expect(event.matchesRequest).toBe(true);
  });

  test('matchesRequest is false when the resolved model differs', () => {
    // The `--use-existing-claude-oauth` substitution is the in-tree path that
    // replaces an already selected model.
    const event = buildModelResolvedEvent({
      requested: null,
      selector: 'opencode/minimax-m2.5-free',
      providerID: 'claude-oauth',
      modelID: 'claude-sonnet-4-5',
      source: 'default',
    });

    expect(event.matchesRequest).toBe(false);
  });
});

describe('selectorMatchesModel', () => {
  test('a qualified selector must match provider and model', () => {
    expect(
      selectorMatchesModel('formalai/formal-ai', 'formalai', 'formal-ai')
    ).toBe(true);
    expect(
      selectorMatchesModel('formalai/formal-ai', 'other', 'formal-ai')
    ).toBe(false);
    expect(
      selectorMatchesModel('formalai/formal-ai', 'formalai', 'other-model')
    ).toBe(false);
  });

  test('a bare selector names only the model, so the provider is free', () => {
    expect(selectorMatchesModel('formal-ai', 'formalai', 'formal-ai')).toBe(
      true
    );
    expect(selectorMatchesModel('formal-ai', 'formalai', 'other-model')).toBe(
      false
    );
  });

  test('a slash inside the model id is still matched in full', () => {
    expect(
      selectorMatchesModel(
        '@link-assistant/formal-ai',
        '@link-assistant',
        'formal-ai'
      )
    ).toBe(true);
  });
});

describe('model_resolved emission', () => {
  test('--model provider/model emits exactly one event with source "cli"', async () => {
    const result = await runParseModelConfig({
      selector: 'formalai/formal-ai',
      argv: { 'compact-json': true },
    });
    expectSuccess(result);

    expect(result.events).toHaveLength(1);
    const [event] = result.events;
    expect(event.type).toBe('model_resolved');
    expect(event.requested).toBe('formalai/formal-ai');
    expect(event.providerID).toBe('formalai');
    expect(event.modelID).toBe('formal-ai');
    expect(event.source).toBe('cli');
    expect(event.matchesRequest).toBe(true);
    expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
  });

  test('--model <bare id> emits exactly one event with source "cli"', async () => {
    const result = await runParseModelConfig({
      selector: 'formal-ai',
      argv: { 'compact-json': true },
    });
    expectSuccess(result);

    expect(result.events).toHaveLength(1);
    const [event] = result.events;
    expect(event.requested).toBe('formal-ai');
    expect(event.providerID).toBe('formal-ai');
    expect(event.modelID).toBe('formal-ai');
    expect(event.source).toBe('cli');
    expect(event.matchesRequest).toBe(true);
  });

  test('no --model emits exactly one event with source "default"', async () => {
    const result = await runParseModelConfig({
      argv: { 'compact-json': true },
    });
    expectSuccess(result);

    expect(result.events).toHaveLength(1);
    const [event] = result.events;
    expect(event.requested).toBeNull();
    expect(event.source).toBe('default');
    expect(event.providerID).toBe('kilo');
    expect(event.modelID).toBe('nemotron-3-super-free');
    expect(event.matchesRequest).toBe(true);
  });

  test('an operator default reports source "config", not "default"', async () => {
    const result = await runParseModelConfig({
      argv: { 'compact-json': true },
      env: { LINK_ASSISTANT_AGENT_DEFAULT_MODEL: 'formalai/formal-ai' },
    });
    expectSuccess(result);

    expect(result.events).toHaveLength(1);
    const [event] = result.events;
    expect(event.requested).toBeNull();
    expect(event.selector).toBe('formalai/formal-ai');
    expect(event.source).toBe('config');
    expect(event.providerID).toBe('formalai');
    expect(event.modelID).toBe('formal-ai');
  });

  test('the claude standard keeps the event on a single NDJSON line', async () => {
    const result = await runParseModelConfig({
      selector: 'formalai/formal-ai',
      // No --compact-json: the claude standard must force compact output anyway,
      // otherwise a pretty-printed event would corrupt the NDJSON stream.
      argv: { 'json-standard': 'claude' },
    });
    expectSuccess(result);

    const rawLines = result.stdout
      .split('\n')
      .filter((line) => line.includes('"model_resolved"'));
    expect(rawLines).toHaveLength(1);
    expect(JSON.parse(rawLines[0]).type).toBe('model_resolved');
  });

  test('an unknown explicit model still fails closed and emits nothing', async () => {
    // #293 behaviour must be preserved: the run must not reach a provider with a
    // model the user did not ask for, and no attestation may claim it did.
    const result = await runParseModelConfig({
      selector: 'formalai/definitely-not-a-real-model',
      argv: { 'compact-json': true },
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.events).toHaveLength(0);
  });
});
