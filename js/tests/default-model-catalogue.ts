import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  checkDefaultModels,
  MODELS_DEV_URL,
  shippedModelIDs,
  unavailableModels,
  ZEN_MODELS_URL,
} from '../../scripts/check-default-models.mjs';
import {
  DEFAULT_MODEL,
  DEFAULT_COMPACTION_MODEL,
  DEFAULT_COMPACTION_MODELS,
  getDefaultModel,
} from '../src/config/defaults';

// Minimal snapshot of the real catalogue evidence for #328, 2026-10-12.
const currentIDs = new Set(['big-pickle', 'gpt-5-nano']);
const currentMetadata = {
  opencode: {
    models: {
      'big-pickle': {},
      'gpt-5-nano': {},
      'minimax-m2.5-free': { status: 'deprecated' },
      'nemotron-3-super-free': { status: 'deprecated' },
      'hy3-preview-free': { status: 'deprecated' },
      'ling-2.6-flash-free': { status: 'deprecated' },
    },
  },
};

function catalogueFetch(zen: unknown, metadata: unknown): typeof fetch {
  return (async (url) =>
    Response.json(url === ZEN_MODELS_URL ? zen : metadata)) as typeof fetch;
}

describe('shipped model catalogue (#328)', () => {
  test('no-argument runs select a currently served model', () => {
    expect(getDefaultModel({ env: {} })).toBe('opencode/big-pickle');
  });

  test('every shipped compaction entry is currently supported', () => {
    expect(
      unavailableModels(shippedModelIDs(), currentIDs, currentMetadata)
    ).toEqual([]);
  });

  test('Rust ships the same default, single compaction model and cascade', () => {
    const rustDefaults = readFileSync(
      new URL('../../rust/src/defaults.rs', import.meta.url),
      'utf8'
    );
    for (const [name, value] of Object.entries({
      DEFAULT_MODEL,
      DEFAULT_COMPACTION_MODEL,
      DEFAULT_COMPACTION_MODELS,
    })) {
      expect(rustDefaults).toMatch(
        new RegExp(
          `${name}: &str =\\s*"${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`
        )
      );
    }
  });

  test('same resolves to the default and duplicate entries are checked once', () => {
    expect(shippedModelIDs()).toEqual([
      'opencode/big-pickle',
      'opencode/gpt-5-nano',
    ]);
  });

  test('missing metadata does not count as a non-deprecated model', () => {
    expect(
      unavailableModels(['opencode/missing'], new Set(), currentMetadata)
    ).toEqual(['opencode/missing']);
  });

  test('either live availability or non-deprecated metadata is sufficient', () => {
    expect(
      unavailableModels(
        ['opencode/live-only', 'opencode/metadata-only'],
        new Set(['live-only']),
        { opencode: { models: { 'metadata-only': { status: 'active' } } } }
      )
    ).toEqual([]);
  });

  test('deprecated and withdrawn models fail with their exact ids', async () => {
    await expect(
      checkDefaultModels({
        fetchFn: catalogueFetch(
          { data: [{ id: 'big-pickle' }] },
          currentMetadata
        ),
        models: ['opencode/minimax-m2.5-free'],
      })
    ).rejects.toThrow('Unavailable shipped models: opencode/minimax-m2.5-free');
  });

  test('Zen ids cannot validate a model from another provider', () => {
    expect(
      unavailableModels(['kilo/big-pickle'], currentIDs, currentMetadata)
    ).toEqual(['kilo/big-pickle']);
  });

  test('a failed endpoint can use the other catalogue', async () => {
    const warnings: string[] = [];
    const fetchFn = (async (url) =>
      url === ZEN_MODELS_URL
        ? new Response('', { status: 503 })
        : Response.json(currentMetadata)) as typeof fetch;
    await expect(
      checkDefaultModels({
        fetchFn,
        models: ['opencode/big-pickle'],
        warn: (s) => warnings.push(s),
      })
    ).resolves.toEqual(['opencode/big-pickle']);
    expect(warnings[0]).toContain('HTTP 503');
  });

  test('invalid responses cannot silently pass the check', async () => {
    const warnings: string[] = [];
    await expect(
      checkDefaultModels({
        fetchFn: catalogueFetch({ data: [] }, {}),
        models: ['opencode/big-pickle'],
        warn: (s) => warnings.push(s),
      })
    ).rejects.toThrow('Unavailable shipped models: opencode/big-pickle');
    expect(warnings).toHaveLength(2);
  });

  test('both catalogue URLs are fetched', async () => {
    const urls: string[] = [];
    const fetchFn = (async (url) => {
      urls.push(String(url));
      return Response.json(
        url === ZEN_MODELS_URL
          ? { data: [{ id: 'big-pickle' }] }
          : currentMetadata
      );
    }) as typeof fetch;
    await checkDefaultModels({ fetchFn, models: ['opencode/big-pickle'] });
    expect(urls).toEqual([ZEN_MODELS_URL, MODELS_DEV_URL]);
  });
});
