import { describe, expect, test } from 'bun:test';
import {
  catalogIDs,
  fetchCatalog,
  missingModels,
} from '../../scripts/model-catalog.mjs';
import { Kilo } from '../src/provider/kilo';
import { OpenCodeZen } from '../src/provider/opencode-zen';

describe('model drift checker (#327)', () => {
  test('CLI exits nonzero and reports both providers when models are withdrawn', async () => {
    const proc = Bun.spawn({
      cmd: [
        'bun',
        '--eval',
        `globalThis.fetch = async () => new Response(JSON.stringify({data: [{id: 'big-pickle'}]}));
         await import('../scripts/check-model-drift.mjs');`,
      ],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect(code).toBe(1);
    expect(stdout).toContain('"provider":"opencode"');
    expect(stdout).toContain('"provider":"kilo"');
    expect(stderr).toContain('nvidia/nemotron-3-super-120b-a12b:free');
    expect(stderr).toContain('nemotron-3.5-lightning-free');
  });
  test('compares gateway IDs, not the user-facing Kilo aliases', () => {
    const live = new Set(
      Object.values(Kilo.FREE_MODELS).map((model) => model.id)
    );
    expect(missingModels(Kilo.FREE_MODELS, live)).toEqual([]);
    live.delete('nvidia/nemotron-3-super-120b-a12b:free');
    expect(missingModels(Kilo.FREE_MODELS, live)).toEqual([
      'nemotron-3-super-free -> nvidia/nemotron-3-super-120b-a12b:free',
    ]);
  });
  test('detects a withdrawn Zen model while allowing extra live models', () => {
    const expected = Object.fromEntries(
      Object.keys(OpenCodeZen.FREE_MODEL_OVERRIDES).map((id) => [id, { id }])
    );
    const live = catalogIDs(
      { data: [{ id: 'big-pickle' }, { id: 'new-free-model' }] },
      'opencode'
    );
    expect(missingModels(expected, live)).toEqual([
      'nemotron-3.5-lightning-free -> nemotron-3.5-lightning-free',
    ]);
  });
  test('fails on malformed or empty catalogs', () => {
    for (const body of [{}, { data: [] }, { data: [{ name: 'no id' }] }]) {
      expect(() => catalogIDs(body, 'kilo')).toThrow('invalid or empty');
    }
  });
  test('fails on HTTP errors and invalid JSON instead of hiding drift', async () => {
    await expect(
      fetchCatalog(
        'http://example.test',
        'kilo',
        async () => new Response('unavailable', { status: 503 })
      )
    ).rejects.toThrow('HTTP 503');
    await expect(
      fetchCatalog(
        'http://example.test',
        'kilo',
        async () => new Response('not json')
      )
    ).rejects.toThrow();
  });
});
