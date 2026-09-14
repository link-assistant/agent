import { describe, expect, test, setDefaultTimeout } from 'bun:test';

/**
 * Secondary calls — compaction and the session summary that reuses the
 * compaction model — must stay on the provider the run was pointed at.
 *
 * The shipped compaction cascade names OpenCode models because the shipped
 * base model is an OpenCode one. A run started with `--model
 * formalai/formal-ai` inherited that cascade verbatim, so every summary and
 * compaction request went to `opencode/big-pickle` — a provider the operator
 * holds no credentials for — and the run's log filled with HTTP 400s from
 * calls nobody asked for.
 *
 * The rule verified here: a compaction default the operator never named
 * follows `--model`; a compaction model the operator *did* name is left
 * exactly as written, cross-provider or not.
 *
 * @see https://github.com/link-assistant/agent/issues/307
 */

setDefaultTimeout(60000);

interface CascadeResult {
  providerID: string;
  modelID: string;
  compactionPrimary: string;
  useSameModel: boolean;
  cascade: string[];
}

/**
 * Resolve the compaction config of a run in a child process, so each case gets
 * a pristine config and provider state.
 */
async function resolveCascade(input: {
  model: string;
  argv?: Record<string, string>;
  processArgv?: string[];
  env?: Record<string, string>;
}): Promise<CascadeResult> {
  const argv = { model: input.model, ...(input.argv ?? {}) };
  const processArgv = [
    'bun',
    'agent',
    '--model',
    input.model,
    ...(input.processArgv ?? []),
  ];

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
          ${JSON.stringify(argv)},
          () => {},
          () => {}
        );
        console.log(
          'RESULT ' +
            JSON.stringify({
              providerID: parsed.providerID,
              modelID: parsed.modelID,
              compactionPrimary:
                parsed.compactionModel.providerID + '/' + parsed.compactionModel.modelID,
              useSameModel: parsed.compactionModel.useSameModel,
              cascade: parsed.compactionModel.compactionModels.map((entry) =>
                entry.useSameModel
                  ? 'same'
                  : entry.providerID + '/' + entry.modelID
              ),
            })
        );
      },
    });

    await Instance.disposeAll();
  `;

  const env: Record<string, string | undefined> = {
    ...process.env,
    FORMAL_AI_API_KEY: 'local-test-token',
    FORMAL_AI_BASE_URL: 'http://127.0.0.1:18080/api/openai/v1',
    LINK_ASSISTANT_AGENT_CONFIG_CONTENT: '{}',
    // The shipped defaults are the subject here, so an ambient override from
    // the surrounding shell must not leak into the child.
    LINK_ASSISTANT_AGENT_DEFAULT_COMPACTION_MODEL: undefined,
    LINK_ASSISTANT_AGENT_DEFAULT_COMPACTION_MODELS: undefined,
    ...(input.env ?? {}),
  };
  for (const key of Object.keys(env)) {
    if (env[key] === undefined) delete env[key];
  }

  const proc = Bun.spawn({
    cmd: ['bun', '--eval', script],
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
    env: env as Record<string, string>,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  const resultLine = stdout
    .split('\n')
    .find((line) => line.startsWith('RESULT '));
  if (!resultLine) {
    throw new Error(
      `parseModelConfig child failed (exit ${exitCode})\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`
    );
  }

  return JSON.parse(resultLine.slice('RESULT '.length));
}

describe('secondary calls inherit --model (#307)', () => {
  test('the built-in cascade does not reach outside the configured provider', async () => {
    const result = await resolveCascade({ model: 'formalai/formal-ai' });

    expect(result.providerID).toBe('formalai');
    expect(result.cascade.length).toBeGreaterThan(0);

    const foreign = result.cascade.filter(
      (entry) => entry !== 'same' && !entry.startsWith('formalai/')
    );
    expect(foreign, `cascade: ${JSON.stringify(result.cascade)}`).toEqual([]);

    // With nothing of the configured provider left in the shipped cascade, the
    // summary and compaction fall back to the model running the turn.
    expect(result.compactionPrimary).toBe('formalai/formal-ai');
    expect(result.useSameModel).toBe(true);
  });

  test('the built-in single compaction model follows the configured provider', async () => {
    const result = await resolveCascade({
      model: 'formalai/formal-ai',
      // An empty cascade selects the single --compaction-model code path.
      argv: { 'compaction-models': '' },
    });

    expect(result.compactionPrimary).toBe('formalai/formal-ai');
    expect(result.useSameModel).toBe(true);
    expect(result.cascade).toEqual(['same']);
  });

  test('a cascade named on the command line is left alone', async () => {
    const result = await resolveCascade({
      model: 'formalai/formal-ai',
      argv: { 'compaction-models': '(opencode/gpt-5-nano same)' },
      processArgv: ['--compaction-models', '(opencode/gpt-5-nano same)'],
    });

    expect(result.cascade).toEqual(['opencode/gpt-5-nano', 'same']);
    expect(result.compactionPrimary).toBe('opencode/gpt-5-nano');
    expect(result.useSameModel).toBe(false);
  });

  test('a single compaction model named on the command line is left alone', async () => {
    const result = await resolveCascade({
      model: 'formalai/formal-ai',
      argv: {
        'compaction-models': '',
        'compaction-model': 'opencode/gpt-5-nano',
      },
      processArgv: ['--compaction-model', 'opencode/gpt-5-nano'],
    });

    expect(result.compactionPrimary).toBe('opencode/gpt-5-nano');
    expect(result.useSameModel).toBe(false);
  });

  test('a cascade configured through the environment is left alone', async () => {
    const result = await resolveCascade({
      model: 'formalai/formal-ai',
      env: {
        LINK_ASSISTANT_AGENT_DEFAULT_COMPACTION_MODELS:
          '(opencode/gpt-5-nano same)',
      },
    });

    expect(result.cascade).toEqual(['opencode/gpt-5-nano', 'same']);
  });

  test('a run on the built-in provider keeps the built-in cascade', async () => {
    const result = await resolveCascade({
      model: 'opencode/big-pickle',
      // Short names in the shipped cascade resolve against whichever provider
      // serves them, which is the rate-limit fallback the cascade exists for.
      // Pin one so the assertion does not depend on the model database.
      env: {
        LINK_ASSISTANT_AGENT_DEFAULT_COMPACTION_MODELS:
          '(kilo/minimax-m2.5-free same)',
      },
    });

    expect(result.cascade).toEqual(['kilo/minimax-m2.5-free', 'same']);
  });
});
