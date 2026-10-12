import { describe, expect, test } from 'bun:test';
import { APICallError } from 'ai';
import { MessageV2 } from '../src/session/message-v2';
import {
  DEFAULT_MODEL,
  DEFAULT_COMPACTION_MODELS,
} from '../src/config/defaults';

const zen = await Bun.file('../experiments/issue-327/zen-models.json').json();
const kilo = await Bun.file('../experiments/issue-327/kilo-models.json').json();
const proc = Bun.spawn({
  cmd: ['bun', '../experiments/issue-327/inspect-models.ts'],
  stdout: 'pipe',
  stderr: 'pipe',
  env: {
    ...process.env,
    KILO_API_KEY: 'local-test-token',
    LINK_ASSISTANT_AGENT_CONFIG_CONTENT: '{}',
    LINK_ASSISTANT_AGENT_DEFAULT_MODEL: '',
    LINK_ASSISTANT_AGENT_DEFAULT_COMPACTION_MODEL: '',
    LINK_ASSISTANT_AGENT_DEFAULT_COMPACTION_MODELS: '',
  },
});
const [stdout, stderr, code] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
  proc.exited,
]);
if (code !== 0) throw new Error(`catalog probe failed: ${stdout}\n${stderr}`);
const result = JSON.parse(
  stdout
    .split('\n')
    .find((line) => line.startsWith('RESULT '))!
    .slice(7)
);

describe('served free models (#327)', () => {
  test('default and compaction start with Kilo Nemotron 3 Super', () => {
    expect(DEFAULT_MODEL).toBe('kilo/nemotron-3-super-free');
    expect(DEFAULT_COMPACTION_MODELS).toStartWith(
      '(kilo/nemotron-3-super-free '
    );
    expect(result.compaction.providerID).toBe('kilo');
    expect(result.compaction.modelID).toBe('nemotron-3-super-free');
  });
  test('Kilo alias maps to the exact gateway ID and resolves without a prefix', () => {
    expect(result.apiModel).toBe('nvidia/nemotron-3-super-120b-a12b:free');
    expect(result.short).toEqual({
      providerID: 'kilo',
      modelID: 'nemotron-3-super-free',
    });
    expect(result.kilo['nemotron-3-super-free'].limit).toEqual({
      context: 262144,
      output: 32768,
    });
  });
  test('all built-in Kilo IDs exist in the gateway snapshot', () => {
    const ids = new Set(kilo.data.map((model: any) => model.id));
    const missing = Object.values(result.kilo).filter(
      (model: any) => !ids.has(model.id)
    );
    expect(missing).toEqual([]);
  });
  test('stale Zen models from models.dev are excluded from the runtime catalog', () => {
    const ids = new Set(zen.data.map((model: any) => model.id));
    expect(Object.keys(result.zen).filter((id) => !ids.has(id))).toEqual([]);
  });
  test('auxiliary model selection uses a served Kilo model', () => {
    expect(result.small).toBe('nemotron-3-super-free');
  });
});

describe('OpenCode free-tier refusal (#327)', () => {
  test('overrides SDK retryability and explains the client restriction', () => {
    const error = new APICallError({
      message: 'Forbidden',
      url: 'https://opencode.ai/zen/v1/chat/completions',
      requestBodyValues: {},
      statusCode: 403,
      isRetryable: true,
      responseBody: JSON.stringify({
        type: 'error',
        error: { type: 'FreeTierError', message: 'Forbidden' },
      }),
    });
    const normalized = MessageV2.fromError(error, { providerID: 'opencode' });
    expect(normalized.data.isRetryable).toBe(false);
    expect(normalized.data.message).toContain('OpenCode clients');
  });
});
